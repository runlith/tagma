import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { kind, own } from '@runlith/testbed/worlds';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { basename, join } from 'node:path';
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Scope, Stream } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { RpcClient } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { softwareDevelopment } from '../../../catalogs/contract/wire/softwareDevelopment.js';
import { rememberedRoots } from '../../../enforcement/testing/doubles.js';
import { Remeasure } from '../../../enforcement/contract/service/remeasure.js';
import { endHosts } from '../../../executions/testing/doubles.js';
import { Catalogs } from '../../../graph/contract/wire/catalogs.js';
import { CHECKOUT_DIRECTORY, FORMAT_FILE } from '../../../graph/contract/wire/storage.js';
import { type Catalog, sectioned } from '../../../graph/contract/wire/tags/declaration.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { blockName } from '../../../graph/contract/wire/references.js';
import { GraphSteps } from '../../../graph/contract/service/steps.js';
import { ProjectLifecycle, ServedGraphs } from '../../../graph/contract/service/serving.js';
import { makeGraphDelivery } from '../../../graph/serving/delivery.js';
import { makeGraphPool } from '../../../graph/serving/pool.js';
import { GRAPH_STEPS } from '../../../graph/steps/sequence.js';
import { mirrorHome, mirrorPath, removeMirror, storageHomes } from '../../../graph/storage/layout.js';
import { routedContext } from '../../../graph/testing/doubles.js';
import { markerText, readMarker } from '../../../graph/tree/marker.js';
import { catalogWriter } from '../../../graph/vocabulary/install.js';
import { frozenBuildsLayer } from '../../../installation/testing/doubles.js';
import { signedBy } from '../../../invocation/testing/call.js';
import { GraphStore } from '../../../platform/contract/service/store.js';
import { liveSerialization } from '../../../platform/contract/wire/live.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { FixtureScope } from '../../../platform/testing/scope.js';
import { projectIdentificationLayer } from '../../../projects/identity.js';
import { TAGMA_SOCKET_PATH } from '../../../socket/rpc.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { assembleWorktrees } from '../../../worktrees/assembly.js';
import { GraphDelivering } from '../../../worktrees/contract/service/retirement.js';
import type { WorktreeRow } from '../../../worktrees/contract/wire/rows.js';
import { bootServer } from '../../boot.js';
import { doorLayer } from '../../http/door.js';
import { LiveRpc } from '../composed.js';
import { makeRuntime, type ServerRuntime } from '../../runtime.js';
import { COMPOSED } from '../composed.js';
import { SHIPPED_CATALOGS } from '../../settings.js';
import { TESTING_ADAPTERS } from '../adapters.js';
import { doorServing } from '../doorServices.js';
import { requestEffect } from '../httpRequest.js';
import { liveGitLayer } from '../liveGit.js';
import { liveDoorLayer } from '../socketDoor.js';
import { suiteGit } from '../suiteGit.js';
import { hostBundleRoot } from '../hostBundle.js';

const NAME = 'idle';
const KEPT = 1;
const BRANCHED = 1;
const DETACHED = 1;

const olderText: Catalog = {
  ...softwareDevelopment,
  tags: softwareDevelopment.tags.map((tag) =>
    tag.id === 'task' ? sectioned({ ...tag, prompt: 'A task, as an older build wrote it.' }) : tag,
  ),
};
const olderCatalogs = Catalogs.of({
  ...SHIPPED_CATALOGS,
  byId: (id) => (id === olderText.id ? olderText : SHIPPED_CATALOGS.byId(id)),
});

const REEXPORTS = { builtin: 'reexports', params: { base: '', allows: [], files: { extensions: ['.ts'], exclude: [] } } };

type Place = { readonly database: string; readonly source: string };

class RestartHome extends Context.Service<RestartHome, FixtureScope>()('testing/IdleCopies') {}
const restartHome = kind(RestartHome, (_params: null, root) => FixtureScope.acquire(root).pipe(Effect.provide(BunFileSystem.layer)));

const booted = Effect.fnUntraced(function* (place: Place) {
  const data = join(place.database, '..');
  const runtime = yield* makeRuntime(
    {
      ...COMPOSED,
      adapters: TESTING_ADAPTERS,
      grants: testGrantSigner,
      profileWindowMs: () => 0,
      quotaProviders: [],
      drivers: ['remeasure'],
      databasePath: place.database,
      tokensPath: join(data, 'tokens.json'),
      attachmentsPath: join(data, 'attachments'),
      sourcePath: place.source,
      hostBundlePath: yield* hostBundleRoot,
    },
    Layer.empty,
    yield* sharedPool,
  );
  yield* bootServer().pipe(Effect.provide(yield* runtime.runtime.contextEffect));
  return runtime;
});

const started = (place: Place) => Effect.tap(booted(place), (runtime) => runtime.openMaintenance);

const doors = Effect.fnUntraced(function* (runtime: ServerRuntime, data: string) {
  const handler = yield* HttpRouter.toHttpEffect(
    doorServing(doorLayer({ status: runtime.status }), runtime, data).pipe(
      Layer.provide(frozenBuildsLayer({ dataPath: data })),
      Layer.provide(Layer.succeedContext(routedContext(runtime.graph, runtime.pool))),
      Layer.provide(Layer.succeedContext(runtime.bindings)),
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(HttpPlatform.layer),
      Layer.provideMerge(BunFileSystem.layer),
    ),
  );
  const server = yield* Layer.build(
    HttpRouter.serve(liveDoorLayer(runtime, data), { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(BunHttpServer.layer({ hostname: '127.0.0.1', port: 0, gracefulShutdownTimeout: '20 millis' })),
    ),
  );
  const url = new URL(TAGMA_SOCKET_PATH, HttpServer.formatAddress(Context.get(server, HttpServer.HttpServer).address));
  url.protocol = 'ws:';
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url.href)),
    Layer.provide([liveSerialization, Socket.layerWebSocketConstructorGlobal]),
  );
  const client = yield* Effect.provide(RpcClient.make(LiveRpc), yield* Layer.build(protocol));
  const op = (id: string, body: unknown, projectId: number) =>
    requestEffect(
      handler,
      new Request(`http://tagma/api/op/${id}?project=${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  return { op, client };
});

type Client = Effect.Success<ReturnType<typeof doors>>['client'];

const settledRows = Effect.fnUntraced(function* (client: Client, projectId: number) {
  const rows = new Map<string, WorktreeRow>();
  let total = -1;
  const settled = () =>
    total >= 0 &&
    rows.size === total &&
    [...rows.values()].every((row) => row.reading !== 'pending' && row.stateFact.state === 'current' && row.mergeFact.state !== 'queued');
  yield* client['worktrees.subscribe']({ projectId, start: 0, limit: 64 }).pipe(
    Stream.tap((frame) =>
      Effect.sync(() => {
        if (frame.kind === 'list') {
          total = frame.total;
          rows.clear();
          for (const row of frame.rows) rows.set(row.rootId, row);
        }
        if (frame.kind === 'row') rows.set(frame.row.rootId, frame.row);
      }),
    ),
    Stream.takeUntil(settled),
    Stream.runDrain,
  );
  return [...rows.values()].map((row) => row.reading);
});

const openings = (pool: ServedGraphs['Service'], root: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const seen: string[] = [];
      const main = Deferred.makeUnsafe<void>();
      const leave = pool.copies.subscribe((event) => {
        if (event.kind !== 'opened') return;
        seen.push(event.checkout);
        if (event.checkout === root) Deferred.doneUnsafe(main, Effect.void);
      });
      return { seen, main, leave };
    }),
    ({ leave }) => Effect.sync(leave),
  );

const mirrorsBeside = Effect.fnUntraced(function* (home: string, main: string) {
  const files = yield* FileSystem.FileSystem;
  if (!(yield* files.exists(home))) return {};
  const standing: Record<string, string> = {};
  for (const name of yield* files.readDirectory(home)) {
    if (name.startsWith(basename(main))) continue;
    const info = yield* files.stat(join(home, name));
    standing[name] = `${info.size}:${info.mtime._tag === 'Some' ? info.mtime.value.getTime() : 'none'}`;
  }
  return standing;
});

it.live(
  'a start on a new graph step and catalog text opens only the main copy, answers graphless calls while its step is held, and leaves idle worktrees and their mirrors untouched',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const fixture = yield* own(restartHome, null, 'the same installation is closed and restarted across a graph upgrade');
      yield* fixture.producer(
        'execution hosts',
        Effect.gen(function* () {
          const survivors = yield* endHosts(fixture.root);
          if (survivors.length > 0)
            return yield* Effect.fail(new Error(`hosts still stand under ${fixture.root}: ${survivors.join(', ')}`));
        }),
      );
      const place: Place = {
        database: join(yield* fixture.directory('data'), 'tagma.sqlite'),
        source: yield* fixture.directory('source/server'),
      };
      const root = yield* files.realPath(yield* fixture.directory('repository'));
      const trees = yield* files.realPath(yield* fixture.directory('worktrees'));

      const parent = yield* Effect.scope;

      const memory = join(place.database, '..', 'enforcement', 'remeasured.json');
      const setup = yield* Scope.fork(parent);
      const born = yield* Scope.provide(started(place), setup);
      const machine = Context.mergeAll(yield* born.runtime.contextEffect, born.owners, born.graph);
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(
        join(root, 'tagma.config.ts'),
        `export default ${JSON.stringify({ inspections: { reexports: REEXPORTS } })};\n`,
      );
      yield* files.makeDirectory(join(root, 'src'));
      yield* files.writeFileString(join(root, 'src', 'value.ts'), 'export const value = 1;\n');
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'code');
      const project = yield* Context.get(machine, ProjectLifecycle)
        .create({ name: NAME, rootPath: root, storage: 'team', catalogs: [softwareDevelopment.id] })
        .pipe(Effect.provide(machine));
      const { appHome } = storageHomes(place.database);
      const home = mirrorHome(appHome, project.id);
      const mainMirror = mirrorPath(appHome, project.id, join(root, CHECKOUT_DIRECTORY));
      const setupDoors = yield* Scope.provide(doors(born, yield* fixture.directory('doors-setup')), setup);
      const served = yield* born.pool.resolve({ projectId: project.id });
      const projectRoot = yield* Effect.provide(
        Effect.flatMap(Blocks, (blocks) => blocks.rootBlockOf(project.id)),
        served.context,
      );
      const rule = yield* setupDoors.op(
        'create_block',
        { parentId: blockName(projectRoot.uuid), tags: ['rule'], title: 'No module re-exports another' },
        project.id,
      );
      expect(rule.status).toBe(200);
      const enforced = yield* setupDoors.op(
        'enforce_rule',
        {
          blockId: (rule.body as { block: { name: string } }).block.name,
          base: null,
          strictness: 'gate',
          inspection: 'reexports',
          on: [{ op: 'submit_work', phase: 'before' }],
        },
        project.id,
      );
      expect(enforced.status).toBe(200);
      yield* born.pool.releaseProject(project.id);
      const remeasure = Context.get(born.enforcement, Remeasure);
      yield* remeasure.ready(project.id, root);
      expect(rememberedRoots(memory)).toContain(root);
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'the graph and its enforced rule');
      const worktrees: string[] = [];
      for (let index = 0; index < KEPT; index += 1) {
        const tree = join(trees, `kept-${index}`);
        yield* suiteGit(root, 'worktree', 'add', '-q', '-b', `kept-${index}`, tree);
        yield* (yield* born.pool.resolve({ projectId: project.id, cwd: tree })).fresh();
        yield* remeasure.ready(project.id, tree);
        worktrees.push(tree);
      }
      expect(rememberedRoots(memory)).toEqual(expect.arrayContaining([root, ...worktrees]));
      const main = yield* born.pool.resolve({ projectId: project.id });
      yield* main.fresh();
      yield* signedBy({ harness: 'test', key: 'idle-copies' })(
        Effect.flatMap(catalogWriter(Context.add(main.context, Catalogs, olderCatalogs), project.id), (write) => write([olderText.id])),
      );
      yield* born.pool.releaseProject(project.id);
      yield* files.writeFileString(join(root, CHECKOUT_DIRECTORY, FORMAT_FILE), markerText(GRAPH_STEPS.at(-2)!.id));
      yield* removeMirror(mainMirror);
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'the graph as an older build left it');
      for (let index = 0; index < BRANCHED; index += 1) {
        const tree = join(trees, `branch-${index}`);
        yield* suiteGit(root, 'worktree', 'add', '-q', '-b', `branch-${index}`, tree);
        worktrees.push(tree);
      }
      for (let index = 0; index < DETACHED; index += 1) {
        const tree = join(trees, `detached-${index}`);
        yield* suiteGit(root, 'worktree', 'add', '-q', '--detach', tree, 'HEAD');
        worktrees.push(tree);
      }
      yield* Context.get(born.workspace, Coverage).cover(project.id);
      yield* Scope.close(setup, Exit.void);

      const readingsDone = [root, ...worktrees].map((): WorktreeRow['reading'] => 'done');
      const heads = yield* Effect.forEach(worktrees, (tree) => suiteGit(tree, 'rev-parse', 'HEAD'));
      expect(yield* Effect.forEach(worktrees, (tree) => suiteGit(tree, 'status', '--porcelain'))).toEqual(worktrees.map(() => ''));
      const mirrors = yield* mirrorsBeside(home, mainMirror);
      expect(Object.keys(mirrors).filter((name) => name.endsWith('.sqlite'))).toHaveLength(KEPT);

      const first = yield* Scope.fork(parent);
      const upgraded = yield* Scope.provide(booted(place), first);
      const firstRuntime = yield* openings(upgraded.pool, root);
      const holding = yield* Scope.fork(first);
      const firstMachine = Context.mergeAll(yield* upgraded.runtime.contextEffect, upgraded.owners, upgraded.graph);
      const entered = yield* Deferred.make<string>();
      const proceed = yield* Deferred.make<void>();
      const shipped = Context.get(firstMachine, GraphSteps);
      const steps = GraphSteps.of({
        ...shipped,
        after: (reached) =>
          shipped.after(reached).map((step) =>
            step.id !== shipped.last
              ? step
              : {
                  id: step.id,
                  run: Effect.fnUntraced(function* (row) {
                    yield* Deferred.succeed(entered, (yield* GraphStore).path);
                    yield* Deferred.await(proceed);
                    yield* step.run(row);
                  }),
                },
          ),
      });
      const pool = yield* Scope.provide(
        Effect.acquireRelease(Effect.provide(makeGraphPool, Context.add(firstMachine, GraphSteps, steps)), (opened) => opened.dispose()),
        holding,
      );
      yield* Scope.addFinalizer(holding, Deferred.succeed(proceed, undefined));
      const pooled = Context.add(firstMachine, ServedGraphs, pool);
      const rebound = Context.add(pooled, GraphDelivering, yield* Effect.provide(makeGraphDelivery, pooled));
      const assembled = yield* Scope.provide(Effect.provide(assembleWorktrees, rebound), holding);
      const held = {
        ...upgraded,
        pool,
        door: Context.mergeAll(upgraded.door, assembled.owners, Context.make(ServedGraphs, pool)),
      };
      const firstHeld = yield* openings(pool, root);
      const firstDoors = yield* Scope.provide(doors(held, yield* fixture.directory('doors-held')), holding);
      const reading = yield* Effect.forkIn(firstDoors.op('read_tree', {}, project.id), holding);
      expect(yield* Deferred.await(entered)).toBe(mainMirror);
      const [threads, terminals, frames] = yield* Effect.all(
        [
          firstDoors.op('list_threads', { limit: 1 }, project.id),
          firstDoors.op('read_terminals', { limit: 1 }, project.id),
          Stream.runCollect(Stream.take(firstDoors.client['worktrees.subscribe']({ projectId: project.id, start: 0, limit: 1 }), 1)),
        ],
        { concurrency: 3 },
      );
      expect(threads).toMatchObject({ status: 200, body: { status: 'ok', threads: expect.any(Array) } });
      expect(terminals).toMatchObject({ status: 200, body: { terminals: [], total: 0 } });
      expect(frames[0]).toMatchObject({ kind: 'list', total: worktrees.length + 1 });
      expect(reading.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(proceed, undefined);
      expect((yield* Fiber.join(reading)).status).toBe(200);
      expect(yield* settledRows(firstDoors.client, project.id)).toEqual(readingsDone);
      yield* Scope.close(holding, Exit.void);
      expect(yield* readMarker(join(root, CHECKOUT_DIRECTORY, FORMAT_FILE))).toEqual({ kind: 'read', step: shipped.last });
      yield* upgraded.openMaintenance;
      yield* Deferred.await(firstRuntime.main);
      const firstDoorsAfter = yield* Scope.provide(doors(upgraded, yield* fixture.directory('doors-first')), first);
      expect(yield* settledRows(firstDoorsAfter.client, project.id)).toEqual(readingsDone);
      yield* Scope.close(first, Exit.void);

      expect(firstHeld.seen).toEqual([root]);
      expect(firstRuntime.seen).toEqual([root]);
      expect(yield* Effect.forEach(worktrees, (tree) => suiteGit(tree, 'rev-parse', 'HEAD'))).toEqual(heads);
      expect(yield* Effect.forEach(worktrees, (tree) => suiteGit(tree, 'status', '--porcelain'))).toEqual(worktrees.map(() => ''));
      expect(yield* mirrorsBeside(home, mainMirror)).toEqual(mirrors);
    }).pipe(Effect.provide(projectIdentificationLayer.pipe(Layer.provideMerge(liveGitLayer), Layer.provideMerge(BunFileSystem.layer)))),
);
