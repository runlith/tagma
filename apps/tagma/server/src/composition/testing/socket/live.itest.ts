import { expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { layer } from '@runlith/effect-test';
import { Context, Data, Effect, FileSystem, Layer, type PlatformError, Queue, Stream, Tracer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcClient, type RpcClientError, type RpcGroup } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { BlockNames } from '../../../graph/contract/service/acts.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { ProjectLifecycle } from '../../../graph/contract/service/serving.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { liveSerialization } from '../../../platform/contract/wire/live.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { websocketHttpTracing } from '../../../socket/live.js';
import { TAGMA_SOCKET_PATH } from '../../../socket/rpc.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { LiveRpc } from '../../rpc.js';
import type { ServerRuntime } from '../../runtime.js';
import { makeDoorWorld } from '../doorFixture.js';
import { liveDoorLayer } from '../socketDoor.js';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import { oauthServer } from '@runlith/mcp/testing/oauth';

type LiveClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof LiveRpc>, RpcClientError.RpcClientError>;

class Live extends Context.Service<Live, LiveClient>()('tagma/test/Live') {}

class World extends Context.Service<
  World,
  {
    readonly runtime: ServerRuntime;
    readonly client: LiveClient;
    readonly spans: Tracer.NativeSpan[];
    readonly changed: Queue.Queue<void>;
    readonly port: number;
    readonly directory: (prefix: string) => Effect.Effect<string, PlatformError.PlatformError>;
  }
>()('tagma/test/World') {}

class SocketUnopened extends Data.TaggedError('SocketUnopened')<{}> {}

const makeWorld = Effect.gen(function* () {
  const spans: Tracer.NativeSpan[] = [];
  const changed = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      Queue.offerUnsafe(changed, undefined);
      return span;
    },
  });
  const files = yield* FileSystem.FileSystem;
  const world = yield* makeDoorWorld();
  const data = yield* world.directory('socket');
  const { runtime } = world;
  const connected = Layer.unwrap(
    Effect.map(HttpServer.HttpServer, (server) =>
      Socket.layerWebSocket(`ws://127.0.0.1:${(server.address as { port: number }).port}${TAGMA_SOCKET_PATH}`),
    ),
  );
  const all = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(connected),
    Layer.provideMerge(
      HttpRouter.serve(liveDoorLayer(runtime, data), { disableListenLog: true, disableLogger: true }).pipe(
        Layer.provide(websocketHttpTracing),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, gracefulShutdownTimeout: '20 millis' })),
    Layer.provide(liveSerialization),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(Layer.succeed(Tracer.Tracer)(tracer)),
  );
  const built = yield* Layer.build(Layer.effect(Live)(RpcClient.make(LiveRpc)).pipe(Layer.provideMerge(all)));
  const server = Context.get(built, HttpServer.HttpServer);
  return Context.add(yield* runtime.runtime.contextEffect, World, {
    runtime,
    client: Context.get(built, Live),
    spans,
    changed,
    port: (server.address as { port: number }).port,
    directory: (prefix) => files.makeTempDirectory({ directory: data, prefix }),
  });
});
const addProject = Effect.fnUntraced(function* (name: string) {
  const { runtime, directory } = yield* World;
  const rootPath = yield* directory('project-');
  return yield* Context.get(runtime.graph, ProjectLifecycle).create({ name: `${name}-${randomUUID()}`, rootPath });
});

const rootOf = Effect.fnUntraced(function* (projectId: number) {
  const { runtime } = yield* World;
  const served = yield* runtime.pool.resolve({ projectId });
  return (yield* Effect.provide(Context.get(served.context, Blocks).rootBlockOf(projectId), served.context)).id;
});

const addBlock = Effect.fnUntraced(function* (input: Parameters<Context.Service.Shape<typeof Blocks>['create']>[0]) {
  const { runtime } = yield* World;
  const served = yield* runtime.pool.resolve({ projectId: input.projectId });
  const born = yield* Effect.provide(Context.get(served.context, Blocks).create(input), served.context);
  const name = yield* Effect.provide(Context.get(served.context, BlockNames).nameOf(born.id), served.context);
  return { ...born, name };
});

const signed = Effect.fnUntraced(function* <A, E>(threadId: string, work: (caller: LiveClient) => Effect.Effect<A, E>) {
  const { port } = yield* World;
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}${TAGMA_SOCKET_PATH}`)),
    Layer.provide(liveSerialization),
    Layer.provide(
      Layer.succeed(
        Socket.WebSocketConstructor,
        (url) =>
          new WebSocket(url, {
            headers: { [GRANT_HEADER]: grantEnvironment(threadId, testSessionIdentity)[GRANT_VARIABLE] as string },
          }),
      ),
    ),
  );
  const context = yield* Layer.build(protocol);
  const caller = yield* Effect.provide(RpcClient.make(LiveRpc), context);
  return yield* work(caller);
});

layer(Layer.effectContext(makeWorld).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('live socket', (it) => {
  it.effect('a feed of a project this installation does not hold is refused before its channel opens', () =>
    Effect.gen(function* () {
      const { client } = yield* World;
      const unknown = 987654;
      const refusals = yield* Effect.all(
        [
          Effect.flip(Stream.runCollect(client['graph.subscribe']({ projectId: unknown }))),
          Effect.flip(Stream.runCollect(client['worktrees.subscribe']({ projectId: unknown, start: 0, limit: 1 }))),
          Effect.flip(Stream.runCollect(client['commands.subscribe']({ projectId: unknown, ended: 0 }))),
        ],
        { concurrency: 'unbounded' },
      );
      for (const refusal of refusals) expect(refusal).toMatchObject({ code: 'not-found' });
    }),
  );

  it.effect('operator feeds serve the app and refuse thread callers in every approval mode', () =>
    Effect.gen(function* () {
      const { client, runtime } = yield* World;
      const project = yield* addProject('feed-callers');
      const trust = yield* birthsOf(runtime.owners).create({ projectId: project.id, createdBySessionId: null, approvalMode: 'trust' });
      const bypass = yield* birthsOf(runtime.owners).create({ projectId: project.id, createdBySessionId: null, approvalMode: 'bypass' });
      const first = <A, E>(stream: Stream.Stream<A, E>) => Stream.runCollect(Stream.take(stream, 1));
      expect(yield* first(client['commands.subscribe']({ projectId: project.id, ended: 0 }))).toMatchObject([
        { _tag: 'Snapshot', snapshot: { projectId: project.id, active: [], ended: [] } },
      ]);
      expect(yield* first(client['artifacts.thread']({ projectId: project.id, threads: [trust.thread.id] }))).toEqual([
        { pages: [], total: 0 },
      ]);
      expect(yield* first(client['installation.next']({}))).toMatchObject([
        { pid: process.pid, offers: [], watched: false, revision: expect.any(Number) },
      ]);
      for (const threadId of [trust.thread.id, bypass.thread.id]) {
        yield* signed(threadId, (caller) =>
          Effect.gen(function* () {
            const refused = yield* Effect.flip(first(caller['artifacts.thread']({ projectId: project.id, threads: [threadId] })));
            expect(refused).toMatchObject({ code: 'operator-only', unblock: expect.any(Array) });
            const machine = yield* Effect.flip(first(caller['attention.subscribe']({})));
            expect(machine).toMatchObject({ code: 'operator-only', unblock: expect.any(Array) });
            const source = yield* Effect.flip(first(caller['installation.next']({})));
            expect(source).toMatchObject({ code: 'operator-only', unblock: expect.any(Array) });
          }),
        ).pipe(Effect.scoped);
      }
    }),
  );

  it.effect('a subscriber opens on resync, and a committed write arrives as a change carrying the fresh rows', () =>
    Effect.gen(function* () {
      const { client } = yield* World;
      const project = yield* addProject('p');
      const frames = yield* Queue.make<unknown>();
      yield* Effect.forkScoped(
        Stream.runForEach(client['graph.subscribe']({ projectId: project.id }), (frame) => Queue.offer(frames, frame)),
      );
      expect(yield* Queue.take(frames)).toEqual({ type: 'resync' });

      const created = yield* addBlock({
        projectId: project.id,
        parentId: yield* rootOf(project.id),
        tags: ['task'],
        title: 'live',
        body: 'detail',
      });
      const change = (yield* Queue.take(frames)) as {
        type: string;
        projectId: number;
        blocks: { name: string; tags: readonly string[]; fields: Readonly<Record<string, unknown>> }[];
        ready: string[];
        events: { op: string }[];
      };
      expect(change.type).toBe('change');
      expect(change.projectId).toBe(project.id);
      expect(change.blocks.map((row) => row.name)).toContain(created.name);
      const row = change.blocks.find((block) => block.name === created.name);
      expect(row).not.toHaveProperty('body');
      expect(row).not.toHaveProperty('payload');
      expect(row?.tags).toEqual(['task']);
      expect(row?.fields).toEqual({ status: 'open' });
      expect(change.ready).toContain(created.name);
      expect(change.events.map((entry) => entry.op)).toContain('create');
    }),
  );

  it.effect('a thread’s work feed opens on resync and names the blocks another writer changed in its copies', () =>
    Effect.gen(function* () {
      const { client, runtime } = yield* World;
      const project = yield* addProject('work');
      const born = yield* birthsOf(runtime.owners).create({ projectId: project.id, createdBySessionId: null }).pipe(Effect.orDie);
      const frames = yield* Queue.make<unknown>();
      yield* Effect.forkScoped(
        Stream.runForEach(client['graph.work']({ projectId: project.id, threadId: born.thread.id }), (frame) => Queue.offer(frames, frame)),
      );
      expect(yield* Queue.take(frames)).toEqual({ type: 'resync' });
      const created = yield* addBlock({ projectId: project.id, parentId: yield* rootOf(project.id), title: 'seen' });
      expect(yield* Queue.take(frames)).toEqual({ type: 'change', own: false, names: [created.name] });
      expect(yield* Effect.flip(Stream.runCollect(client['graph.work']({ projectId: project.id, threadId: 'no-thread' })))).toMatchObject({
        code: 'not-found',
      });
    }),
  );

  it.effect('socket generations expose RPC work and a typed close without a lifetime HTTP span', () =>
    Effect.gen(function* () {
      const { client, runtime, spans, changed, port } = yield* World;
      const project = yield* addProject('telemetry');
      const created = yield* birthsOf(runtime.owners).create({ projectId: project.id, createdBySessionId: null }).pipe(Effect.orDie);

      expect(
        yield* client['thread.entry']({ projectId: project.id, threadId: created.thread.id, params: { entryId: 'missing' } }),
      ).toBeNull();
      const request = spans.find((span) => span.name === 'RpcServer.thread.entry');
      const opening = spans.length;
      const socket = new WebSocket(`ws://127.0.0.1:${port}${TAGMA_SOCKET_PATH}`);
      yield* Effect.callback<void, SocketUnopened>((resume) => {
        socket.addEventListener('open', () => resume(Effect.void), { once: true });
        socket.addEventListener('error', () => resume(Effect.fail(new SocketUnopened())), { once: true });
      });
      yield* Effect.callback<void>((resume) => {
        socket.addEventListener('close', () => resume(Effect.void), { once: true });
        socket.close(1000);
      });
      while (!spans.slice(opening).some((span) => span.name === 'WebSocket.close')) yield* Queue.take(changed);

      const lifecycle = spans.slice(opening);
      const opened = lifecycle.find((span) => span.name === 'WebSocket.open');
      const closed = lifecycle.find((span) => span.name === 'WebSocket.close');
      const generation = opened?.attributes.get('generation');
      const requestGeneration = request?.attributes.get('generation');
      if (typeof generation !== 'number' || typeof requestGeneration !== 'number') {
        return yield* Effect.die('the socket and its earlier RPC must carry numeric generations');
      }
      expect(requestGeneration).toBeLessThan(generation);
      expect(closed?.attributes.get('generation')).toBe(generation);
      expect(closed?.attributes.get('closeCause')).toBe('interrupted');
      expect(spans.some((span) => span.name === 'http.server GET' && span.attributes.get('http.route') === TAGMA_SOCKET_PATH)).toBe(false);
    }),
  );

  it.effect('the MCP rows feed follows a declaration no pool runs, a server asking for a sign-in, and the sign-in that connects it', () =>
    Effect.gen(function* () {
      const { client, runtime } = yield* World;
      const servers = Context.get(runtime.owners, McpServers);
      const oauth = yield* oauthServer();
      const { id: projectId } = yield* addProject('mcp-rows');
      type Row = { readonly name: string; readonly status: string };
      const frames = yield* Queue.make<readonly Row[]>();
      const until = Effect.fnUntraced(function* (name: string, status: string) {
        let rows = yield* Queue.take(frames);
        while (!rows.some((row) => row.name === name && row.status === status)) rows = yield* Queue.take(frames);
        return rows;
      });
      yield* Effect.forkScoped(Stream.runForEach(client['mcp.servers']({ projectId }), (rows) => Queue.offer(frames, rows)));
      expect(yield* Queue.take(frames)).toEqual([]);

      const capabilities = { kinds: [], mutates: false };
      const keyed = { name: 'keyed', transport: 'http' as const, url: '${KEYED_URL}', capabilities, enabled: true };
      yield* servers.add({ projectId, scope: 'project', declaration: keyed });
      expect(yield* until('keyed', 'needs-value')).toMatchObject([{ name: 'keyed', status: 'needs-value' }]);
      yield* servers.remove({ projectId, scope: 'project', name: 'keyed' });
      let rows = yield* Queue.take(frames);
      while (rows.length > 0) rows = yield* Queue.take(frames);

      const guarded = { name: 'guarded', transport: 'http' as const, url: oauth.url, capabilities, enabled: true };
      yield* servers.add({ projectId, scope: 'project', declaration: guarded });
      yield* Effect.addFinalizer(() => Effect.orDie(servers.remove({ projectId, scope: 'project', name: 'guarded' })));
      yield* until('guarded', 'needs-sign-in');
      const { url } = yield* servers.signIn({ projectId, scope: 'project', name: 'guarded', redirect: 'http://tagma/mcp/oauth/callback' });
      const returned = yield* oauth.follow(url);
      const answer = (name: string) => returned.searchParams.get(name);
      yield* servers.finishSignIn({ state: answer('state'), code: answer('code'), iss: answer('iss'), error: null, description: null });
      expect(yield* until('guarded', 'connected')).toMatchObject([{ name: 'guarded', status: 'connected' }]);
    }),
  );
});
