import { expect } from 'bun:test';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { layer } from '@runlith/effect-test';
import { Context, Data, Effect, FileSystem, Latch, Layer, Option, Schedule, Schema, Stream } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { RpcClient } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { LiveRpc } from '../../rpc.js';
import { liveSerialization } from '../../../platform/contract/wire/live.js';
import { websocketHttpTracing } from '../../../socket/live.js';
import { TAGMA_SOCKET_PATH } from '../../../socket/rpc.js';
import { Connections } from '../../../socket/connections.js';
import { Access } from '../../../remote/contract/service/access.js';
import { PlacedSites } from '../../../remote/contract/service/sites.js';
import { Devices } from '../../../remote/contract/service/devices.js';
import { type AccessState, DEVICE_COOKIE, DEVICE_REVOKED_CLOSE, PAIRING_ENDPOINT } from '../../../remote/contract/wire/access.js';
import { exposedAt } from '../../../remote/testing/doubles.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { SESSION_HEADER } from '../../../platform/contract/wire/session.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { frozenBuildsLayer } from '../../../installation/testing/doubles.js';
import { startupStateSchema } from '../../../installation/contract/wire/restart.js';
import { remoteDriving, remoteListener, remoteServing } from '../../http/remote.js';
import { sandboxRoutes } from '../../http/sites.js';
import { doorServicesOf } from '../doorServices.js';
import { makeDoorWorld } from '../doorFixture.js';
import { REPORT_PATH } from '../../../desktop-browser/contract/wire/channel.js';

const ORIGIN = 'https://tagma-test.tail0000.ts.net';
const SITE = `${ORIGIN}:11001`;
const ELSEWHERE = 'https://other.tail0000.ts.net';

const certified = Latch.makeUnsafe(true);
let sandboxState: AccessState = { _tag: 'certificate', origin: `${ORIGIN}:8443` };
let siteRefused = false;
const SITE_REFUSAL: AccessState = { _tag: 'blocked', problem: 'refused', detail: 'tailscale serve failed once', command: null, link: null };

const forged = {
  [SESSION_HEADER]: 'claude-code:forged',
  [GRANT_HEADER]: grantFor('forged-thread'),
  'tailscale-user-login': 'operator@example.com',
  'x-forwarded-for': '127.0.0.1',
  'x-forwarded-host': 'localhost:5633',
};

class NotYet extends Data.TaggedError('NotYet')<{ readonly waiting: string }> {}
class RemoteBlocked extends Data.TaggedError('RemoteBlocked')<{ readonly state: unknown }> {}

const freePort = Effect.promise(async () => {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const free = probe.port as number;
  await probe.stop(true);
  return free;
});

type World = Effect.Success<ReturnType<typeof makeDoorWorld>>;

const switchedIn = Effect.fnUntraced(function* (world: World, project: number, on: boolean) {
  expect(yield* world.op('write_setting', { key: 'remote.enabled', value: on }, `project=${project}`)).toMatchObject({ status: 200 });
});

const reachedIn = (world: World, state: string) =>
  Effect.retry(
    Effect.gen(function* () {
      const now = ((yield* world.op('read_remote_access', {})).body as { state: { _tag: string } }).state;
      if (now._tag === state) return;
      if (now._tag === 'blocked') return yield* Effect.die(new RemoteBlocked({ state: now }));
      return yield* new NotYet({ waiting: state });
    }),
    { schedule: Schedule.spaced('10 millis') },
  );

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld({
    own: 'it installs a plugin and changes remote access for the whole server',
    exposure: exposedAt(
      ORIGIN,
      certified,
      'test-machine',
      () => sandboxState,
      (at) => (siteRefused ? SITE_REFUSAL : { _tag: 'ready', origin: at }),
    ),
  });
  const files = yield* FileSystem.FileSystem;
  const root = yield* world.directory('project');
  const project = yield* world.stealthProject(root);
  const ui = join(root, '.plugins', 'static', 'ui');
  yield* files.makeDirectory(ui, { recursive: true });
  yield* files.writeFileString(
    join(ui, '..', 'plugin.json'),
    JSON.stringify({
      id: 'static',
      title: 'Static',
      contributes: { views: [{ id: 'page', entry: 'ui/page.html' }] },
    }),
  );
  yield* files.writeFileString(join(ui, 'page.html'), '<!doctype html><script type="module" src="./view.js"></script>');
  yield* files.writeFileString(join(ui, 'view.js'), 'export default 42;');
  expect(yield* world.op('install_plugin', { id: 'static' }, `project=${project}`)).toMatchObject({ status: 200 });
  const home = yield* world.directory('remote');
  const shell = yield* world.directory('shell');
  yield* files.writeFileString(join(shell, 'index.html'), '<!doctype html><title>Tagma</title>');
  const connections = new Connections();
  const door = yield* doorServicesOf(world.runtime, home);
  const serving = (listening: number) =>
    remoteServing({ door, status: world.runtime.status, appDist: shell, artifacts: world.runtime.artifacts, connections }).pipe(
      Layer.provide(websocketHttpTracing),
      Layer.provideMerge(BunHttpServer.layer({ hostname: '127.0.0.1', port: listening, gracefulShutdownTimeout: '20 millis' })),
      Layer.provide(frozenBuildsLayer({ dataPath: home })),
      Layer.provide(Layer.succeedContext(world.routed)),
      Layer.provide(Layer.succeedContext(world.runtime.bindings)),
      Layer.provide(BunFileSystem.layer),
    );
  const port = yield* freePort;
  const listener = remoteListener(serving, connections, port);
  yield* Effect.forkScoped(
    remoteDriving(Context.get(world.runtime.door, Devices), Context.get(world.runtime.door, Access), listener, connections).pipe(
      Effect.scoped,
    ),
  );
  yield* switchedIn(world, project, true);
  yield* reachedIn(world, 'ready');
  yield* switchedIn(world, project, true);
  yield* reachedIn(world, 'ready');
  return { world, port, project };
});

class Remote extends Context.Service<Remote, Effect.Success<typeof setup>>()('testing/RemoteDoor') {}

const remote = Effect.fnUntraced(function* (
  path: string,
  init: { method?: string; body?: unknown; credential?: string; origin?: string | null; headers?: Record<string, string> } = {},
) {
  const { port } = yield* Remote;
  return yield* Effect.promise(() =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.origin === null ? {} : { origin: init.origin ?? ORIGIN }),
        ...(init.credential === undefined ? {} : { cookie: `${DEVICE_COOKIE}=${init.credential}` }),
        ...init.headers,
      },
      body: JSON.stringify(init.body),
    }),
  );
});

const rawStatus = Effect.fnUntraced(function* (path: string) {
  const { port } = yield* Remote;
  return yield* Effect.callback<number>((resume) => {
    let head = '';
    const raw = createConnection(port, '127.0.0.1', () =>
      raw.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`),
    );
    raw.on('data', (chunk) => {
      head += chunk.toString();
    });
    raw.on('end', () => resume(Effect.succeed(Number(head.split(' ')[1]))));
    raw.on('error', (cause) => resume(Effect.die(cause)));
    return Effect.sync(() => void raw.destroy());
  });
});

const refusal = (response: Response) => Effect.promise(async () => [response.status, ((await response.json()) as { code: string }).code]);

const framing = (response: Response) => [
  response.headers.get('x-frame-options'),
  (response.headers.get('content-security-policy') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('frame-ancestors')),
];

const codeOf = Effect.fnUntraced(function* () {
  const { world } = yield* Remote;
  const made = yield* world.op('create_pairing', {});
  expect(made.status).toBe(200);
  return (made.body as { pairing: { code: string } }).pairing.code;
});

const exchange = (code: string) =>
  remote(PAIRING_ENDPOINT.path, { method: 'POST', body: { code }, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/605.1' } });

const credentialOf = (response: Response): string | undefined =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${DEVICE_COOKIE}=`))
    ?.slice(DEVICE_COOKIE.length + 1)
    .split(';')[0];

const paired = Effect.fnUntraced(function* () {
  const answered = yield* exchange(yield* codeOf());
  expect(answered.status).toBe(200);
  const credential = credentialOf(answered);
  expect(credential, 'the pairing answer set no device cookie').toBeDefined();
  const body = (yield* Effect.promise(() => answered.json())) as { device: { id: string } };
  return { id: body.device.id, credential: credential as string };
});

const socket = Effect.fnUntraced(function* (
  credential: string | undefined,
  options: { readonly path?: string; readonly origin?: string } = {},
) {
  const { port } = yield* Remote;
  const connection = yield* Effect.promise(
    () =>
      new Promise<{ readonly opened: boolean; readonly code: number; readonly ws: WebSocket }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${options.path ?? TAGMA_SOCKET_PATH}`, {
          headers: {
            origin: options.origin ?? ORIGIN,
            ...(credential === undefined ? forged : { cookie: `${DEVICE_COOKIE}=${credential}` }),
          },
        } as unknown as string[]);
        let opened = false;
        ws.addEventListener('open', () => {
          opened = true;
          resolve({ opened, code: 0, ws });
        });
        ws.addEventListener('close', (event) => resolve({ opened, code: event.code, ws }));
      }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => connection.ws.close()));
  return connection;
});

const closedPromise = (ws: WebSocket) => new Promise<number>((resolve) => ws.addEventListener('close', (event) => resolve(event.code)));

const switched = Effect.fnUntraced(function* (on: boolean) {
  const { world, project } = yield* Remote;
  yield* switchedIn(world, project, on);
});

const reached = Effect.fnUntraced(function* (state: string) {
  const { world } = yield* Remote;
  yield* reachedIn(world, state);
});

const websocketProtocol = Effect.fnUntraced(function* (headers: Record<string, string>) {
  const { port } = yield* Remote;
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}${TAGMA_SOCKET_PATH}`)),
    Layer.provide(liveSerialization),
    Layer.provide(Layer.succeed(Socket.WebSocketConstructor, (url) => new WebSocket(url, { headers }))),
  );
});

layer(Layer.effect(Remote, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('remote door', (it) => {
  it.effect('server namespaces cannot register as project names', () =>
    Effect.gen(function* () {
      const { world } = yield* Remote;
      const root = yield* world.directory('reserved');
      for (const name of ['a', 'A', 'api', 'health']) {
        const answer = yield* world.op('add_project', { name, rootPath: root, storage: 'stealth' });
        expect(answer.body).toMatchObject({ code: 'reserved-project' });
      }
    }),
  );

  it.effect(
    'without a device credential nothing but the shell answers, whatever session, grant or Tailscale headers come with the request',
    () =>
      Effect.gen(function* () {
        const paths = [
          ['POST', '/api/op/list_threads'],
          ['POST', '/API/op/list_threads'],
          ['GET', '/health'],
          ['GET', '/startup'],
          ['GET', '/health/'],
          ['GET', '/a/'],
          ['GET', '/api/openapi.json'],
          ['GET', '/%61pi/openapi.json'],
          ['GET', '/_app/immutable/entry/start.js.map'],
        ] as const;
        for (const [method, path] of paths) {
          const answered = yield* remote(path, { method, body: method === 'POST' ? {} : undefined, headers: forged });
          expect([path, ...(yield* refusal(answered))]).toEqual([path, 401, 'device-unpaired']);
        }
        expect(yield* rawStatus('//api//openapi.json')).toBe(401);
        expect(yield* socket(undefined)).toMatchObject({ opened: false });
        expect(yield* socket(undefined, { path: '/API/ws' })).toMatchObject({ opened: false });
        const shell = yield* remote('/pair', { headers: { ...forged, accept: 'text/html' } });
        expect([shell.status, ...framing(shell)]).toEqual([200, 'DENY', ["frame-ancestors 'none'"]]);
        expect(yield* Effect.promise(() => shell.text())).toContain('<title>Tagma</title>');
      }),
  );

  it.effect('a paired device receives the startup projection through the admitted remote door', () =>
    Effect.gen(function* () {
      const device = yield* paired();
      const response = yield* remote('/startup', { credential: device.credential });
      expect(response.status).toBe(200);
      expect(yield* Schema.decodeUnknownEffect(startupStateSchema)(yield* Effect.promise(() => response.json()))).toEqual({
        startup: null,
        issue: null,
        restart: null,
      });
    }),
  );

  it.effect('a phone is handed each plugin’s own remote site, which alone serves its views and whose pages the door refuses', () =>
    Effect.gen(function* () {
      const { world, project } = yield* Remote;
      const device = yield* paired();
      const protocol = yield* websocketProtocol({ origin: ORIGIN, cookie: `${DEVICE_COOKIE}=${device.credential}` });
      const site = yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* Effect.provide(RpcClient.make(LiveRpc), yield* Layer.build(protocol));
          const served = yield* Stream.runHead(
            client['views.subscribe']({ projectId: project }).pipe(
              Stream.map((state) => state.plugins.find((set) => set.plugin === 'static')?.site),
              Stream.filter((found) => found?._tag === 'served'),
            ),
          );
          return Option.getOrThrow(served);
        }),
      );
      expect(site?._tag, 'the phone was handed no site for the plugin').toBe('served');
      if (site?._tag !== 'served') return;
      expect(site.origin).toBe(SITE);
      const host = new URL(site.origin).host;
      const { handler, dispose } = HttpRouter.toWebHandler(
        sandboxRoutes(world.runtime.views, Context.get(world.runtime.door, Access), Context.get(world.runtime.door, PlacedSites)).pipe(
          Layer.provide(HttpServer.layerServices),
          Layer.provideMerge(HttpPlatform.layer),
          Layer.provideMerge(BunFileSystem.layer),
        ),
        { disableLogger: true },
      );
      const page = yield* Effect.promise(() => handler(new Request('http://127.0.0.1/ui/page.html', { headers: { host } })));
      expect(page.status).toBe(200);
      expect((page.headers.get('content-security-policy') ?? '').split('; ')).toContain(
        'frame-ancestors http://127.0.0.1:* http://localhost:* http://[::1]:* ' + ORIGIN,
      );
      const wrongHost = yield* Effect.promise(() =>
        handler(new Request('http://127.0.0.1/ui/page.html', { headers: { host: `${new URL(ORIGIN).host}:8443` } })),
      );
      expect(wrongHost.status).toBe(404);
      yield* Effect.promise(() => dispose());
      expect(
        yield* refusal(
          yield* remote('/api/op/create_pairing', { method: 'POST', body: {}, credential: device.credential, origin: site.origin }),
        ),
      ).toEqual([403, 'origin-refused']);
      expect(yield* socket(device.credential, { origin: site.origin })).toMatchObject({ opened: false });
      const read = yield* remote('/health', { credential: device.credential, origin: null, headers: { 'sec-fetch-site': 'same-site' } });
      expect(yield* refusal(read)).toEqual([403, 'origin-refused']);
    }),
  );

  it.effect(
    'a paired device acts as the operator under its own id, and a forged session header beside its credential changes nothing',
    () =>
      Effect.gen(function* () {
        const device = yield* paired();
        const health = yield* remote('/health', { credential: device.credential });
        expect(yield* Effect.promise(() => health.json())).toMatchObject({ sandboxOrigin: `${ORIGIN}:8443` });
        const read = yield* remote('/api/op/read_remote_access', {
          method: 'POST',
          body: {},
          credential: device.credential,
          headers: forged,
        });
        expect([read.status, ...framing(read)]).toEqual([200, 'DENY', ["frame-ancestors 'none'"]]);
        expect(((yield* Effect.promise(() => read.json())) as { device: string | null }).device).toBe(device.id);
      }),
  );

  it.effect('a paired device receives operator thread, execution and artifact feeds despite forged session headers', () =>
    Effect.gen(function* () {
      const { world, project } = yield* Remote;
      const device = yield* paired();
      const born = yield* world.op('create_thread', { approvalMode: 'trust' }, `project=${project}`);
      const threadId = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const protocol = yield* websocketProtocol({ origin: ORIGIN, cookie: `${DEVICE_COOKIE}=${device.credential}`, ...forged });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(protocol);
          const client = yield* Effect.provide(RpcClient.make(LiveRpc), context);
          const thread = yield* Stream.runCollect(Stream.take(client['thread.subscribe']({ projectId: project, threadId }), 1));
          expect(thread).toMatchObject([{ type: 'snapshot', payload: { snapshot: { thread: { id: threadId } } } }]);
          const executions = yield* Stream.runCollect(Stream.take(client['commands.subscribe']({ projectId: project, ended: 0 }), 1));
          expect(executions).toMatchObject([{ _tag: 'Snapshot', snapshot: { projectId: project, active: [], ended: [] } }]);
          const artifacts = yield* Stream.runCollect(
            Stream.take(client['artifacts.thread']({ projectId: project, threads: [threadId] }), 1),
          );
          expect(artifacts).toEqual([{ pages: [], total: 0 }]);
        }),
      );
    }),
  );

  it.effect('a paired device cannot attach a desktop browser host nor open its report stream', () =>
    Effect.gen(function* () {
      const device = yield* paired();
      const protocol = yield* websocketProtocol({ origin: ORIGIN, cookie: `${DEVICE_COOKIE}=${device.credential}` });
      const attached = yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* Effect.provide(RpcClient.make(LiveRpc), yield* Layer.build(protocol));
          return yield* Effect.flip(Stream.runHead(client.attach_browser_host({ host: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b', pid: 1 })));
        }),
      );
      expect(attached).toMatchObject({ code: 'device-refused' });
      const reported = yield* remote(`${REPORT_PATH}?host=6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b&generation=1`, {
        credential: device.credential,
      });
      expect(yield* refusal(reported)).toEqual([403, 'device-refused']);
    }),
  );

  it.effect('a sandboxed page is framed only by its own door and reaches no API: its requests carry Origin null and are refused', () =>
    Effect.gen(function* () {
      const { world } = yield* Remote;
      const files = yield* FileSystem.FileSystem;
      const device = yield* paired();
      const page = join(yield* world.directory('page'), 'page.html');
      yield* files.writeFileString(page, '<!doctype html><title>Report</title><script>fetch("/api/op/list_threads")</script>');
      const published = yield* world.runtime.artifacts.publish({ path: page, thread: 'lead' });
      const served = yield* remote(`/a/${published.record.id}`, { credential: device.credential });
      expect([served.status, ...framing(served)]).toEqual([200, 'SAMEORIGIN', ["frame-ancestors 'self'"]]);
      const policy = (served.headers.get('content-security-policy') ?? '').split(';').map((part) => part.trim());
      expect(policy).toContain("connect-src 'none'");
      expect(
        policy
          .find((part) => part.startsWith('sandbox'))
          ?.split(' ')
          .sort(),
      ).toEqual(['allow-popups', 'allow-popups-to-escape-sandbox', 'allow-scripts', 'sandbox']);
      const fromPage = yield* remote('/api/op/create_pairing', {
        method: 'POST',
        body: {},
        credential: device.credential,
        origin: 'null',
      });
      expect(yield* refusal(fromPage)).toEqual([403, 'origin-refused']);
    }),
  );

  it.effect('a page of another origin opens no socket with a paired device credential', () =>
    Effect.gen(function* () {
      const device = yield* paired();
      expect(yield* socket(device.credential, { origin: ELSEWHERE })).toMatchObject({ opened: false });
    }),
  );

  it.effect('revoking a device closes its open socket with the revocation code and turns its credential away', () =>
    Effect.gen(function* () {
      const { world } = yield* Remote;
      const device = yield* paired();
      const open = yield* socket(device.credential);
      expect(open.opened).toBe(true);
      const ended = closedPromise(open.ws);
      expect((yield* world.op('revoke_device', { device: device.id })).status).toBe(200);
      expect(yield* Effect.promise(() => ended)).toBe(DEVICE_REVOKED_CLOSE);
      const after = yield* remote('/health', { credential: device.credential });
      expect(yield* refusal(after)).toEqual([401, 'device-revoked']);
    }),
  );

  it.effect('a paired device is admitted while the door warms up again on the origin it was paired at', () =>
    Effect.gen(function* () {
      const device = yield* paired();
      certified.closeUnsafe();
      yield* switched(false);
      yield* reached('off');
      yield* switched(true);
      yield* reached('certificate');
      const health = yield* remote('/health', { credential: device.credential });
      expect(yield* Effect.promise(() => health.json())).toMatchObject({ sandboxOrigin: `${ORIGIN}:8443` });
      const read = yield* remote('/api/op/read_remote_access', { method: 'POST', body: {}, credential: device.credential });
      expect(read.status).toBe(200);
      certified.openUnsafe();
      yield* reached('ready');
    }),
  );

  it.effect('sandbox failure disables views while the paired door and pairing stay ready', () =>
    Effect.gen(function* () {
      yield* switched(false);
      yield* reached('off');
      const { world } = yield* Remote;
      const access = Context.get(world.runtime.door, Access);
      expect(access.parentOrigin).toBeNull();
      expect(access.sandboxOrigin).toBeNull();
      sandboxState = {
        _tag: 'blocked',
        problem: 'origin-taken',
        detail: 'the sandbox port serves another mapping',
        command: null,
        link: null,
      };
      yield* switched(true);
      yield* reached('ready');
      const device = yield* paired();
      const read = yield* remote('/api/op/read_remote_access', { method: 'POST', body: {}, credential: device.credential });
      expect(yield* Effect.promise(() => read.json())).toMatchObject({ state: { _tag: 'ready', origin: ORIGIN }, sandbox: sandboxState });
      const health = yield* remote('/health', { credential: device.credential });
      expect(yield* Effect.promise(() => health.json())).toMatchObject({ sandboxOrigin: null });
      const opened = yield* socket(device.credential);
      expect(opened.opened).toBe(true);
      opened.ws.close();
      yield* switched(false);
      yield* reached('off');
      sandboxState = { _tag: 'certificate', origin: `${ORIGIN}:8443` };
      yield* switched(true);
      yield* reached('ready');
    }),
  );

  it.effect('a plugin site refused once leaves the door ready, is placed again when the access is read, and keeps its port', () =>
    Effect.gen(function* () {
      const { world } = yield* Remote;
      const siteOf = Effect.suspend(() =>
        Effect.map(world.op('read_remote_access', {}), (answer) => (answer.body as { sites: Record<string, AccessState> }).sites['static']),
      );
      const settles = (tag: AccessState['_tag']) =>
        Effect.retry(
          Effect.flatMap(siteOf, (site) => (site?._tag === tag ? Effect.succeed(site) : Effect.fail(new NotYet({ waiting: tag })))),
          { schedule: Schedule.spaced('50 millis') },
        );
      yield* switched(false);
      yield* reached('off');
      siteRefused = true;
      yield* switched(true);
      yield* reached('ready');
      expect((yield* settles('blocked'))._tag).toBe('blocked');
      siteRefused = false;
      expect(yield* settles('ready')).toEqual({ _tag: 'ready', origin: SITE });
    }),
  );

  it.effect('the pairing exchange refuses another origin before it reads the body, and a body past one kilobyte', () =>
    Effect.gen(function* () {
      const unread = yield* remote(PAIRING_ENDPOINT.path, { method: 'POST', body: 'not a code', origin: ELSEWHERE });
      expect(yield* refusal(unread)).toEqual([403, 'origin-refused']);
      const long = yield* remote(PAIRING_ENDPOINT.path, { method: 'POST', body: { code: '0'.repeat(2048) } });
      expect(yield* refusal(long)).toEqual([400, 'body-shape']);
    }),
  );

  it.effect('two exchanges of one code at once pair one device, and wrong codes past the budget are refused while the code stands', () =>
    Effect.gen(function* () {
      const { world } = yield* Remote;
      const before = ((yield* world.op('list_devices', {})).body as { total: number }).total;
      const code = yield* codeOf();
      const raced = yield* Effect.all([exchange(code), exchange(code)], { concurrency: 'unbounded' });
      expect(raced.map((answered) => answered.status).sort()).toEqual([200, 401]);
      expect(((yield* world.op('list_devices', {})).body as { total: number }).total).toBe(before + 1);

      const standing = yield* codeOf();
      const wrong = standing.startsWith('0') ? '1111-1111' : '0000-0000';
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 10; attempt += 1) statuses.push((yield* exchange(wrong)).status);
      expect(statuses.at(-1)).toBe(429);
      expect((yield* exchange(standing)).status).toBe(429);
      expect(yield* codeOf()).toBe(standing);
    }).pipe(Effect.provideServiceEffect(Remote, setup)),
  );
});
