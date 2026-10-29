import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { oauthServer } from '@runlith/mcp/testing/oauth';
import { Context, Effect } from 'effect';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import { DOOR_ORIGIN, doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

type Row = {
  readonly name: string;
  readonly status: string;
  readonly tools: number;
  readonly identity: string;
  readonly signIn?: {
    readonly signedIn: boolean;
    readonly pending: boolean;
    readonly client: string | null;
    readonly redirect: string | null;
  };
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
  return answer.body as { readonly mcp?: readonly Row[]; readonly url?: string; readonly skipped?: string };
});

const DOCUMENT = 'https://tagma.dev/oauth/client.json';

const publishing = (listing: { redirects: readonly string[] }) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const real = globalThis.fetch;
      const answering = async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        String(input) === DOCUMENT
          ? Response.json({ client_id: DOCUMENT, client_name: 'Tagma', redirect_uris: listing.redirects })
          : real(input, init);
      globalThis.fetch = Object.assign(answering, { preconnect: real.preconnect.bind(real) });
      return real;
    }),
    (real) =>
      Effect.sync(() => {
        globalThis.fetch = real;
      }),
  );

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
    'a server asking for OAuth reads needs-sign-in; only a live state it issued, naming the issuer its metadata promises, connects it; a reconnect leaves it pending and a scope step-up asks again',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const servers = Context.get(world.runtime.owners, McpServers);
        const oauth = yield* oauthServer();
        const oidc = yield* oauthServer('oidc');
        const project = yield* world.plainProject();
        yield* projectLeaving(world, project);

        const added = yield* answered('add_mcp_server', declared('guarded', oauth.url), project);
        expect(added.mcp?.find((row) => row.name === 'guarded')).toMatchObject({
          status: 'needs-sign-in',
          signIn: { signedIn: false, pending: false, client: null, redirect: `${DOOR_ORIGIN}/mcp/oauth/callback` },
        });

        expect(yield* callback(new URL(`${DOOR_ORIGIN}/mcp/oauth/callback?state=unknown&code=forged`))).toBe(400);
        const mismatched = yield* oauth.follow(yield* signIn(project, { name: 'guarded' }));
        expect(yield* callback(reissued(mismatched, 'https://elsewhere.invalid'))).toBe(400);
        expect(yield* callback(mismatched)).toBe(400);
        const unnamed = yield* oauth.follow(yield* signIn(project, { name: 'guarded' }));
        expect(yield* callback(reissued(unnamed, null))).toBe(400);
        const outlived = yield* oauth.follow(yield* signIn(project, { name: 'guarded' }));
        yield* answered('sign_out_mcp_server', { name: 'guarded' }, project);
        expect(yield* callback(outlived)).toBe(400);
        expect(yield* rowIn(project, 'guarded')).toMatchObject({ status: 'needs-sign-in', signIn: { signedIn: false, pending: false } });

        yield* answered('add_mcp_server', declared('openid', oidc.url), project);
        const unnamedOpenId = yield* oidc.follow(yield* signIn(project, { name: 'openid' }));
        expect(yield* callback(reissued(unnamedOpenId, null))).toBe(400);
        expect(yield* rowIn(project, 'openid')).toMatchObject({ status: 'needs-sign-in', signIn: { signedIn: false } });
        yield* answered('remove_mcp_server', { name: 'openid' }, project);

        const pending = yield* oauth.follow(yield* signIn(project, { name: 'guarded' }));
        expect(yield* rowIn(project, 'guarded')).toMatchObject({ signIn: { pending: true } });
        yield* answered('enable_mcp_server', { name: 'guarded', enabled: false }, project);
        yield* answered('enable_mcp_server', { name: 'guarded' }, project);
        yield* servers.reconcile(project);
        expect(yield* rowIn(project, 'guarded')).toMatchObject({ status: 'needs-sign-in', signIn: { pending: true } });
        expect(yield* callback(pending)).toBe(200);
        expect(yield* rowIn(project, 'guarded')).toMatchObject({
          status: 'connected',
          tools: 2,
          signIn: { signedIn: true, pending: false, client: 'registered' },
        });

        expect(yield* Effect.flip(servers.caller(project).call('guarded', 'escalate', {}, {}))).toMatchObject({
          _tag: 'McpNeedsSignIn',
          scope: 'tools admin',
        });
        expect(yield* rowIn(project, 'guarded')).toMatchObject({ status: 'needs-sign-in', signIn: { signedIn: true } });

        const signedOut = yield* answered('sign_out_mcp_server', { name: 'guarded' }, project);
        expect(signedOut.mcp?.find((row) => row.name === 'guarded')).toMatchObject({
          status: 'needs-sign-in',
          signIn: { signedIn: false, client: 'registered' },
        });
        yield* answered('remove_mcp_server', { name: 'guarded' }, project);
      }),
  );

  it.effect(
    'a client metadata document signs in only where it lists the calling door’s callback; one that does not list it falls to dynamic registration',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const oauth = yield* oauthServer('oauth', { documents: true });
        const project = yield* world.plainProject();
        yield* projectLeaving(world, project);
        const door = `${DOOR_ORIGIN}/mcp/oauth/callback`;
        const other = 'http://127.0.0.1:5643/mcp/oauth/callback';
        const listing = { redirects: [door] };
        yield* publishing(listing);

        oauth.document(DOCUMENT, [door]);
        yield* answered('add_mcp_server', declared('listed', oauth.url), project);
        const used = yield* answered('sign_in_mcp_server', { name: 'listed' }, project);
        expect(used.skipped).toBeUndefined();
        expect(yield* callback(yield* oauth.follow(used.url ?? ''))).toBe(200);
        expect(yield* rowIn(project, 'listed')).toMatchObject({ status: 'connected', signIn: { signedIn: true, client: 'document' } });

        yield* answered('sign_out_mcp_server', { name: 'listed' }, project);
        listing.redirects = [other];
        oauth.document(DOCUMENT, [other]);
        const registered = yield* answered('sign_in_mcp_server', { name: 'listed' }, project);
        expect(registered.skipped).toContain(`does not list ${door}`);
        expect(yield* callback(yield* oauth.follow(registered.url ?? ''))).toBe(200);
        expect(yield* rowIn(project, 'listed')).toMatchObject({ status: 'connected', signIn: { signedIn: true, client: 'registered' } });
      }),
  );

  it.effect(
    'an expiring and then a rejected token of a user server are each refreshed once for two project pools at a rotating server, keeping its identity and its sessions',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const oauth = yield* oauthServer();
        const servers = Context.get(world.runtime.owners, McpServers);
        const first = yield* world.plainProject();
        const second = yield* world.plainProject();
        yield* projectLeaving(world, first, second);
        yield* answered('add_mcp_server', declared('shared', oauth.url, 'user'), first);
        yield* Effect.addFinalizer(() => Effect.orDie(answered('remove_mcp_server', { name: 'shared', scope: 'user' }, first)));
        yield* servers.reconcile(first);
        yield* servers.reconcile(second);
        expect(yield* rowIn(second, 'shared')).toMatchObject({ status: 'needs-sign-in' });

        const returned = yield* oauth.follow(yield* signIn(first, { name: 'shared', scope: 'user' }));
        oauth.shortLived(1);
        const rejections = oauth.rejections();
        expect(yield* callback(returned)).toBe(200);
        const before = yield* rowIn(second, 'shared');
        expect(before).toMatchObject({ status: 'connected', tools: 2 });
        expect(yield* rowIn(first, 'shared')).toMatchObject({ status: 'connected', tools: 2 });
        expect([oauth.refreshes(), oauth.rejections()]).toEqual([1, rejections]);
        const sessions = oauth.sessions();

        oauth.expire(2);
        const both = yield* Effect.all(
          [servers.caller(first).call('shared', 'whoami', {}, {}), servers.caller(second).call('shared', 'whoami', {}, {})],
          { concurrency: 2 },
        );
        for (const echoed of both) expect(JSON.stringify(echoed)).toContain('Bearer [redacted]');
        expect(oauth.refreshes()).toBe(2);
        expect((yield* rowIn(second, 'shared'))?.identity).toBe(before?.identity);
        expect(oauth.sessions()).toBe(sessions);
      }),
  );
});
