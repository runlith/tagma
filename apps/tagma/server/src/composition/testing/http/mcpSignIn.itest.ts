import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { oauthServer } from '@runlith/mcp/testing/oauth';
import { Context, Effect } from 'effect';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

type Row = {
  readonly name: string;
  readonly status: string;
  readonly tools: number;
  readonly identity: string;
  readonly signIn?: { readonly signedIn: boolean; readonly pending: boolean; readonly client: string | null };
};

const declared = (name: string, url: string, scope?: 'user') => ({
  name,
  transport: 'http',
  url,
  capabilities: { kinds: ['network'], mutates: false },
  ...(scope === undefined ? {} : { scope }),
});

const answered = Effect.fnUntraced(function* (id: string, input: unknown, project: number) {
  const world = yield* DoorFixture;
  const answer = yield* world.op(id, input, `project=${project}`);
  if (answer.status !== 200) return yield* Effect.die(new Error(`${id} answered ${answer.status}: ${JSON.stringify(answer.body)}`));
  return answer.body as { readonly mcp?: readonly Row[]; readonly url?: string };
});

const rowIn = Effect.fnUntraced(function* (project: number, name: string) {
  return (yield* answered('read_mcp_servers', {}, project)).mcp?.find((row) => row.name === name);
});

const signIn = Effect.fnUntraced(function* (project: number, input: { readonly name: string; readonly scope?: 'user' }) {
  const { url } = yield* answered('sign_in_mcp_server', input, project);
  if (url === undefined) return yield* Effect.die(new Error('sign_in_mcp_server answered no url'));
  return url;
});

const callback = Effect.fnUntraced(function* (returned: URL) {
  const world = yield* DoorFixture;
  return (yield* world.call(`${returned.pathname}${returned.search}`)).status;
});

const reissued = (returned: URL, iss: string | null) => {
  const changed = new URL(returned);
  if (iss === null) changed.searchParams.delete('iss');
  else changed.searchParams.set('iss', iss);
  return changed;
};

layer(doorFixture(), { excludeTestServices: true })('mcp sign-in', (it) => {
  it.effect(
    'a server asking for OAuth reads needs-sign-in, a reconnect leaves its pending sign-in completing, and only the state it issued with the issuer it named connects it',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const oauth = yield* oauthServer;
        const project = yield* world.plainProject();
        yield* projectLeaving(world, project);

        const added = yield* answered('add_mcp_server', declared('guarded', oauth.url), project);
        expect(added.mcp?.find((row) => row.name === 'guarded')).toMatchObject({
          status: 'needs-sign-in',
          signIn: { signedIn: false, pending: false, client: null },
        });

        expect(yield* callback(new URL('http://tagma/mcp/oauth/callback?state=unknown&code=forged'))).toBe(400);
        const mismatched = yield* oauth.follow(yield* signIn(project, { name: 'guarded' }));
        expect(yield* callback(reissued(mismatched, 'https://elsewhere.invalid'))).toBe(400);
        expect(yield* callback(mismatched)).toBe(400);
        const unnamed = yield* oauth.follow(yield* signIn(project, { name: 'guarded' }));
        expect(yield* callback(reissued(unnamed, null))).toBe(400);
        expect(yield* rowIn(project, 'guarded')).toMatchObject({ status: 'needs-sign-in', signIn: { signedIn: false } });

        const pending = yield* oauth.follow(yield* signIn(project, { name: 'guarded' }));
        expect(yield* rowIn(project, 'guarded')).toMatchObject({ signIn: { pending: true } });
        yield* answered('enable_mcp_server', { name: 'guarded', enabled: false }, project);
        yield* answered('enable_mcp_server', { name: 'guarded' }, project);
        yield* Context.get(world.runtime.owners, McpServers).reconcile(project);
        expect(yield* rowIn(project, 'guarded')).toMatchObject({ status: 'needs-sign-in', signIn: { pending: true } });
        expect(yield* callback(pending)).toBe(200);
        expect(yield* rowIn(project, 'guarded')).toMatchObject({
          status: 'connected',
          tools: 1,
          signIn: { signedIn: true, pending: false, client: 'registered' },
        });

        const signedOut = yield* answered('sign_out_mcp_server', { name: 'guarded' }, project);
        expect(signedOut.mcp?.find((row) => row.name === 'guarded')).toMatchObject({
          status: 'needs-sign-in',
          signIn: { signedIn: false, client: 'registered' },
        });
        yield* answered('remove_mcp_server', { name: 'guarded' }, project);
      }),
  );

  it.effect(
    'an expired token of a user server is refreshed once for two project pools at a rotating server, keeping its identity and its sessions',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const oauth = yield* oauthServer;
        const servers = Context.get(world.runtime.owners, McpServers);
        const first = yield* world.plainProject();
        const second = yield* world.plainProject();
        yield* projectLeaving(world, first, second);
        yield* answered('add_mcp_server', declared('shared', oauth.url, 'user'), first);
        yield* Effect.addFinalizer(() => Effect.orDie(answered('remove_mcp_server', { name: 'shared', scope: 'user' }, first)));
        yield* servers.reconcile(first);
        yield* servers.reconcile(second);
        expect(yield* rowIn(second, 'shared')).toMatchObject({ status: 'needs-sign-in' });

        expect(yield* callback(yield* oauth.follow(yield* signIn(first, { name: 'shared', scope: 'user' })))).toBe(200);
        const before = yield* rowIn(second, 'shared');
        expect(before).toMatchObject({ status: 'connected', tools: 1 });
        const sessions = oauth.sessions();

        oauth.expire(2);
        const [one, two] = yield* Effect.all(
          [servers.caller(first).call('shared', 'whoami', {}, {}), servers.caller(second).call('shared', 'whoami', {}, {})],
          { concurrency: 2 },
        );
        expect(oauth.refreshes()).toBe(1);
        for (const echoed of [one, two]) expect(JSON.stringify(echoed)).toContain('Bearer [redacted]');
        expect((yield* rowIn(second, 'shared'))?.identity).toBe(before?.identity);
        expect(oauth.sessions()).toBe(sessions);
      }),
  );
});
