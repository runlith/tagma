import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { keyedServer } from '@runlith/mcp/testing/keyed';
import { oauthServer } from '@runlith/mcp/testing/oauth';
import { Context, Effect } from 'effect';
import type { ConnectorEntry, ConnectorSignIn } from '../../../connectors/contract/wire/entry.js';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import type { ConnectorRow } from '../../../connectors/contract/wire/rows.js';
import type { McpServerRow } from '../../../mcp/contract/wire/servers.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

const KEY = 'connector-key-5be21c';

const entry = (id: string, url: string, signIn: ConnectorSignIn): ConnectorEntry => ({
  id,
  title: id,
  description: `The ${id} test service.`,
  icon: 'M0 0h24v24H0z',
  url,
  signIn,
  capabilities: { kinds: ['network'], mutates: false },
});

type Answer = {
  readonly connector?: ConnectorRow;
  readonly connectors?: readonly ConnectorRow[];
  readonly url?: string;
  readonly mcp?: readonly McpServerRow[];
};

layer(doorFixture(), { excludeTestServices: true })('connectors', (it) => {
  it.effect(
    'connecting declares the service in the given scope and signs it in or takes its key; a second connect refuses; disconnecting leaves no token, value or client behind',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const oauth = yield* oauthServer();
        const keyed = yield* keyedServer(KEY);
        yield* world.lend({
          connectors: [
            entry('signed', oauth.url, { kind: 'oauth' }),
            entry('keyed', keyed.url, { kind: 'key', headers: { Authorization: 'Bearer ${KEYED_TOKEN}' }, obtain: 'https://keys.invalid' }),
          ],
        });
        const project = yield* world.plainProject();
        yield* projectLeaving(world, project);
        const answered = Effect.fnUntraced(function* (id: string, input: unknown) {
          const answer = yield* world.op(id, input, `project=${project}`);
          if (answer.status !== 200) return yield* Effect.die(new Error(`${id} answered ${answer.status}: ${JSON.stringify(answer.body)}`));
          return answer.body as Answer;
        });
        const stateOf = Effect.fnUntraced(function* (id: string) {
          return (yield* answered('read_connectors', {})).connectors?.find((row) => row.id === id);
        });
        const callback = Effect.fnUntraced(function* (authorization: string | undefined) {
          const returned = yield* oauth.follow(authorization ?? '');
          return (yield* world.call(`${returned.pathname}${returned.search}`)).status;
        });

        const connected = yield* answered('connect_service', { id: 'signed', scope: 'user' });
        yield* Effect.addFinalizer(() =>
          Effect.orDie(Effect.asVoid(world.op('remove_mcp_server', { name: 'signed', scope: 'user' }, `project=${project}`))),
        );
        expect(connected.connector).toMatchObject({ state: 'needs-sign-in', server: { name: 'signed', scope: 'user', changed: false } });
        expect(yield* callback(connected.url)).toBe(200);
        expect(yield* stateOf('signed')).toMatchObject({ state: 'connected' });
        const marked = (yield* answered('read_mcp_servers', {})).mcp?.filter((row) => row.connector === 'signed');
        expect(marked).toMatchObject([
          { name: 'signed', scope: 'user', status: 'connected', signIn: { signedIn: true, client: 'registered' } },
        ]);

        const again = yield* world.op('connect_service', { id: 'signed', scope: 'user' }, `project=${project}`);
        expect(again.body).toMatchObject({ code: 'mcp-server-exists' });

        const keyedConnect = yield* answered('connect_service', { id: 'keyed' });
        expect([keyedConnect.connector?.state, keyedConnect.url]).toEqual(['needs-value', undefined]);
        yield* answered('set_secret', { owner: 'mcp', id: 'project/keyed', name: 'KEYED_TOKEN', value: KEY });
        expect(yield* stateOf('keyed')).toMatchObject({ state: 'connected', server: { scope: 'project' } });
        const shadowed = yield* world.op('connect_service', { id: 'keyed', scope: 'user' }, `project=${project}`);
        expect(shadowed.body).toMatchObject({ code: 'mcp-server-exists' });
        const standing = (yield* answered('read_mcp_servers', {})).mcp?.find((row) => row.name === 'keyed');
        expect([standing?.scope, standing?.shadows]).toEqual(['project', undefined]);

        expect((yield* answered('disconnect_service', { id: 'signed' })).connector).toMatchObject({ state: 'available' });
        expect((yield* answered('disconnect_service', { id: 'keyed' })).connector).toMatchObject({ state: 'available' });
        expect((yield* answered('read_mcp_servers', {})).mcp?.filter((row) => row.connector !== undefined)).toEqual([]);

        const reconnected = yield* answered('connect_service', { id: 'signed', scope: 'user' });
        expect((yield* answered('read_mcp_servers', {})).mcp?.find((row) => row.name === 'signed')).toMatchObject({
          status: 'needs-sign-in',
          signIn: { signedIn: false, client: null },
        });
        expect(reconnected.url).toBeDefined();
        expect((yield* answered('connect_service', { id: 'keyed' })).connector?.state).toBe('needs-value');
        yield* answered('disconnect_service', { id: 'keyed' });
        yield* answered('disconnect_service', { id: 'signed' });
      }),
  );

  it.effect(
    'a project declining the operator’s servers reads its connector connected, off in this project, keeps declining while it declares its own and takes them back',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const oauth = yield* oauthServer();
        const keyed = yield* keyedServer(KEY);
        yield* world.lend({ connectors: [entry('shared', oauth.url, { kind: 'oauth' })] });
        const project = yield* world.plainProject();
        yield* projectLeaving(world, project);
        const servers = Context.get(world.runtime.owners, McpServers);
        const call = (id: string, input: unknown) => world.op(id, input, `project=${project}`);
        const answered = Effect.fnUntraced(function* (id: string, input: unknown) {
          const answer = yield* call(id, input);
          if (answer.status !== 200) return yield* Effect.die(new Error(`${id} answered ${answer.status}: ${JSON.stringify(answer.body)}`));
          return answer.body as Answer;
        });
        const shared = Effect.map(answered('read_connectors', {}), (read) => read.connectors?.find((row) => row.id === 'shared'));
        const offered = () => servers.palette(project).map((tool) => tool.declaration.name);
        const declining = (declined: boolean) => answered('write_setting_layer', { scope: 'project', key: 'mcp.servers', declined });

        const connected = yield* answered('connect_service', { id: 'shared', scope: 'user' });
        yield* Effect.addFinalizer(() => Effect.orDie(Effect.asVoid(call('remove_mcp_server', { name: 'shared', scope: 'user' }))));
        const returned = yield* oauth.follow(connected.url ?? '');
        expect((yield* world.call(`${returned.pathname}${returned.search}`)).status).toBe(200);
        yield* servers.reconcile(project);
        expect([(yield* shared)?.state, offered()]).toEqual(['connected', ['shared']]);

        yield* declining(true);
        expect([yield* shared, offered()]).toMatchObject([{ state: 'declined', server: { scope: 'user' } }, []]);
        const own = {
          name: 'own',
          transport: 'http',
          url: keyed.url,
          headers: { Authorization: `Bearer ${KEY}` },
          capabilities: { kinds: ['network'], mutates: false },
        };
        yield* answered('add_mcp_server', own);
        expect([(yield* shared)?.state, offered()]).toEqual(['declined', ['own']]);
        const valued = yield* call('write_setting_layer', { scope: 'project', key: 'mcp.servers', value: [], declined: false });
        const cleared = yield* call('write_setting', { key: 'mcp.servers' });
        expect([valued.body, cleared.body]).toMatchObject([{ code: 'setting-managed' }, { code: 'setting-managed' }]);
        expect((yield* shared)?.state).toBe('declined');

        yield* declining(false);
        expect([(yield* shared)?.state, offered().sort()]).toEqual(['connected', ['own', 'shared']]);
        yield* answered('remove_mcp_server', { name: 'own' });
      }),
  );
});
