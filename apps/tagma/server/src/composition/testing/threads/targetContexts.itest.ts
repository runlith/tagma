import { fixtureMigrations } from '../migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Effect, FileSystem, Layer, Path } from 'effect';
import { EnvironmentId } from '../../../workspace/contract/wire/environments.js';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { NamespaceId } from '@runlith/files/namespace';
import { project, projectsLayer } from '../../../projects/testing/doubles.js';
import { threadRun } from '../../../threads/testing/doubles.js';
import { MachineStore, type StoreDb, type StoreFailure } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { fixtureHome } from '../../../platform/testing/roots.js';
import { type AssignmentActor } from '../../../workspace/contract/wire/assignments.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import { rootOf } from '../../../threads/testing/doubles.js';
import type { ProvedRoot, TargetAt } from '../../../workspace/contract/wire/place.js';
import { threadParts, type ThreadParts } from '../threadParts.js';
import { threadStore, targetSnapshotStore, type ThreadStore } from '../../../native-harness/testing/doubles.js';
import { TargetSnapshots } from '../../../threads/contract/service/targetSnapshots.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { assignmentStore } from '../../../workspace/testing/doubles.js';
import { assignmentLedger } from '../../../workspace/testing/doubles.js';
import { fileRootStore } from '../../../workspace/testing/doubles.js';
import { rootRegistry } from '../../../workspace/testing/doubles.js';
import { FileRoots, type RootReservations } from '../../../workspace/contract/service/roots.js';
import { Assignments } from '../../../workspace/contract/service/assignments.js';

import { targetContexts } from '../../../threads/testing/doubles.js';
import { asWorldAcquire } from '../../../threads/testing/doubles.js';
import { checkoutWorld } from '../../../executions/testing/doubles.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import type { ThreadWorld } from '../../../executions/contract/service/worlds.js';
import type { Worlds } from '../../../executions/contract/service/worlds.js';
import { leasedWorlds } from '../../../executions/testing/doubles.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { ENTRY_KINDS } from '../../manifest.js';

const namespaceId = NamespaceId.make('test-targets');
const unreserved: RootReservations['Service'] = { holding: () => Effect.succeed(new Map()) };
const operator = { kind: 'operator' } as const satisfies AssignmentActor;
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
);
const layers = Layer.mergeAll(projectsLayer().pipe(Layer.provideMerge(storage)), BunFileSystem.layer, Path.layer);

type Owned = {
  readonly db: StoreDb<'machine'>;
  readonly units: MachineUnits['Service'];
  readonly files: FileSystem.FileSystem;
  readonly paths: Path.Path;
  readonly roots: FileRoots['Service'];
  readonly kernel: ThreadStore;
  readonly threads: ThreadParts;
  readonly assignments: Assignments['Service'];
  readonly targets: TargetSnapshots['Service'];
  readonly worlds: Worlds['Service'];
  readonly contexts: Effect.Success<ReturnType<typeof targetContexts>>;
  readonly home: string;
};

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'targets-' });
  const paths = yield* Path.Path;
  const store = yield* MachineStore;
  const { db } = store;
  const units = yield* MachineUnits;
  const roots = yield* rootRegistry(yield* fileRootStore(db, units), files, paths, namespaceId, unreserved);
  const records = yield* makeThreadRecords;
  const kernel = yield* threadStore(records, ENTRY_KINDS);
  const threads = yield* threadParts({ db, units, threads: kernel, records });
  const assignments = yield* assignmentLedger(assignmentStore(db), roots, yield* lineageOver(store, units));
  const targets = yield* targetSnapshotStore();
  const worlds = yield* leasedWorlds({
    checkout: (_thread, root) =>
      Effect.succeed(checkoutWorld({ projectRoot: root, scratch: `${root}/.scratch`, world: makeMachineWorld(() => null) })),
    hosts: [],
    place: () => Effect.succeed(null),
  });
  return {
    home,
    db,
    units,
    files,
    paths,
    roots,
    kernel,
    threads,
    assignments,
    targets,
    worlds,
    contexts: yield* targetContexts().pipe(
      Effect.provideService(TargetSnapshots, targets),
      Effect.provideService(Assignments, assignments),
      Effect.provideService(FileRoots, roots),
    ),
  };
});

const registerProject = Effect.fnUntraced(function* (db: StoreDb<'machine'>, name: string, rootPath: string) {
  const row = yield* db
    .insert(project())
    .values({ name, repoKey: `/${name}`, rootPath, createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning({ id: project().id })
    .get();
  if (row === undefined) return yield* Effect.die(new Error('the test project was not registered'));
  return row.id;
});

const born = (held: Owned, projectId: number) =>
  held.units.write('TargetContexts.born', (unit) =>
    Effect.gen(function* () {
      const row = yield* held.kernel.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
      yield* held.threads.rows.attachFacet({ threadId: row.id, projectId }, unit);
      return ThreadId.make(row.id);
    }),
  );

const running = (db: StoreDb<'machine'>, threadId: string, runId: string): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(db.insert(threadRun()).values({ id: runId, threadId, ownerId: 'operator', status: 'running' }));

const directory = (held: Owned, name: string): Effect.Effect<string, never> =>
  Effect.map(Effect.orDie(held.files.makeDirectory(held.paths.join(held.home, name), { recursive: true })), () =>
    held.paths.join(held.home, name),
  );

const registerRoot = (held: Owned, path: string) => held.roots.register({ path, provenance: { kind: 'test', id: 'targets' } });

const acquire =
  (held: Owned, thread: { id: string }): ReturnType<typeof asWorldAcquire> =>
  (request) =>
    held.worlds.of({ thread: { id: thread.id, hostKind: null, hostId: null }, at: request.at, root: request.root });

const at = (threadId: string, runId: string, generation: number): TargetAt => ({
  threadId,
  runId,
  generation: WorkspaceGeneration.make(generation),
});

it.live('generation zero is composed from the placement and recorded, and a named generation is restored from the record', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'targets', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const thread = { id: threadId, projectId };

    const opened = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread));
    expect(opened.target.workingRoot).toBe(checkout);
    expect(opened.target.sourceKey).toBe('intrinsic');
    expect(opened.target.generation).toBe(WorkspaceGeneration.make(0));
    expect(opened.world.root).toBe(checkout);

    const root = yield* registerRoot(held, worktree);
    yield* held.units.write('TargetContexts', (unit) =>
      held.assignments.select(unit, {
        actor: operator,
        threadId,
        root: { rootId: root.rootId, locationRevision: root.locationRevision },
      }),
    );

    const restored = yield* held.contexts.of(
      thread,
      { kind: 'run', runId: 'run-1', context: { generation: 0, sourceKey: 'intrinsic', requestId: 'req-0' } },
      acquire(held, thread),
    );
    expect(restored.target).toEqual(opened.target);
    expect(restored.target.workingRoot).toBe(checkout);

    yield* held.worlds.release(at(threadId, 'run-1', 0));
    const again = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread));
    expect(again.target).toEqual(opened.target);
    expect(again.world.root).toBe(checkout);

    yield* held.worlds.release(at(threadId, 'run-1', 0));
    yield* held.units.write('TargetContexts', (unit) => held.assignments.clear(unit, { actor: operator, threadId }));
    const cleared = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread));
    expect(cleared.target).toEqual(opened.target);
    expect(cleared.world.root).toBe(checkout);
  }).pipe(Effect.provide(layers)),
);

it.live('a generation the record does not carry refuses, rather than composing a fresh one', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const projectId = yield* registerProject(held.db, 'targets', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const thread = { id: threadId, projectId };

    const refused = yield* Effect.flip(
      held.contexts.of(
        thread,
        { kind: 'run', runId: 'run-1', context: { generation: 3, sourceKey: 'root:gone', requestId: 'req-3' } },
        acquire(held, thread),
      ),
    );
    expect(refused._tag).toBe('GateRefusal');
    expect((refused as { code: string }).code).toBe('target-unrecorded');
  }).pipe(Effect.provide(layers)),
);

it.live('a cleared placement refuses, and is never read as the intrinsic one', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const projectId = yield* registerProject(held.db, 'targets', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const thread = { id: threadId, projectId };

    yield* held.units.write('TargetContexts', (unit) => held.assignments.clear(unit, { actor: operator, threadId }));
    const refused = yield* Effect.flip(held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread)));
    expect(refused._tag).toBe('GateRefusal');
    expect((refused as { code: string }).code).toBe('target-no-destination');
    expect((refused as { reason: string }).reason).toContain('cleared');
  }).pipe(Effect.provide(layers)),
);

it.live('a prepared destination lands in the publication unit, and a late release of the generation it left touches neither', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'targets', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const thread = { id: threadId, projectId };

    const a = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread));
    const root = yield* registerRoot(held, worktree);
    yield* held.units.write('TargetContexts', (unit) =>
      held.assignments.select(unit, {
        actor: operator,
        threadId,
        root: { rootId: root.rootId, locationRevision: root.locationRevision },
      }),
    );

    const prepared = yield* held.contexts.prepare(
      { thread, runId: 'run-1', fromGeneration: WorkspaceGeneration.make(0), requestId: 'req-1' },
      acquire(held, thread),
    );
    expect(prepared.target.generation).toBe(WorkspaceGeneration.make(1));
    expect(prepared.target.workingRoot).toBe(root.path);
    expect(prepared.ask.sourceKey).toBe(`root:${root.rootId}`);
    expect(yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 1), unit))).toBeUndefined();

    yield* held.units.write('TargetContexts', (unit) => Effect.orDie(prepared.ask.commit!(unit)));
    expect(yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 1), unit))).toEqual(prepared.target);

    yield* held.worlds.release(at(threadId, 'run-1', 0));
    const elsewhere = yield* registerRoot(held, yield* directory(held, 'elsewhere'));
    yield* held.units.write('TargetContexts', (unit) =>
      held.assignments.select(unit, {
        actor: operator,
        threadId,
        root: { rootId: elsewhere.rootId, locationRevision: elsewhere.locationRevision },
      }),
    );
    const b = yield* held.contexts.of(
      thread,
      { kind: 'run', runId: 'run-1', context: { generation: 1, sourceKey: prepared.ask.sourceKey, requestId: 'req-1' } },
      acquire(held, thread),
    );
    expect(b.world.root).toBe(root.path);
    expect(b.world).toBe(prepared.world);
    expect(yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 0), unit))).toEqual(a.target);
  }).pipe(Effect.provide(layers)),
);

it.live('a placement overtaken between preparation and publication refuses in the unit, and records nothing', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const later = yield* directory(held, 'later');
    const projectId = yield* registerProject(held.db, 'targets', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const thread = { id: threadId, projectId };
    yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread));

    const first = yield* registerRoot(held, worktree);
    yield* held.units.write('TargetContexts', (unit) =>
      held.assignments.select(unit, {
        actor: operator,
        threadId,
        root: { rootId: first.rootId, locationRevision: first.locationRevision },
      }),
    );
    const prepared = yield* held.contexts.prepare(
      { thread, runId: 'run-1', fromGeneration: WorkspaceGeneration.make(0), requestId: 'req-1' },
      acquire(held, thread),
    );

    const second = yield* registerRoot(held, later);
    yield* held.units.write('TargetContexts', (unit) =>
      held.assignments.select(unit, {
        actor: operator,
        threadId,
        root: { rootId: second.rootId, locationRevision: second.locationRevision },
      }),
    );

    const refused = yield* Effect.flip(held.units.write('TargetContexts.refused', (unit) => prepared.ask.commit!(unit)));
    expect(String((refused as { message?: string }).message ?? refused)).toContain('overtaken');
    expect(yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 1), unit))).toBeUndefined();
  }).pipe(Effect.provide(layers)),
);

const PROVEN: ProvedRoot = {
  environment: {
    environmentId: EnvironmentId.make('host'),
    kind: 'host',
    namespaceId: NamespaceId.make('ns-1'),
    identityWitness: { provider: 'test', format: 'test', token: 'env' },
  },
  root: { namespaceId: NamespaceId.make('ns-1'), path: '/repo' },
  witness: { provider: 'test', format: 'test', token: 'repo' },
  registration: null,
};

const guestWorld = (): ThreadWorld => ({
  kind: 'sandbox',
  facts: { shared: false, history: false, network: false },
  world: { files: machineWorld.files, environment: { ...machineWorld.environment, platform: 'linux' } },
  root: '/work',
  scratch: '/work/.scratch',
  alive: () => true,
});

it.live(
  'an intrinsic guest records the root of its own world and no proved place, and a registered local root selected for it fabricates neither',
  () =>
    Effect.gen(function* () {
      const held = yield* fixture;
      const checkout = yield* directory(held, 'checkout');
      const worktree = yield* directory(held, 'worktree');
      const projectId = yield* registerProject(held.db, 'guest', checkout);
      const threadId = yield* born(held, projectId);
      yield* running(held.db, threadId, 'run-1');
      const thread = { id: threadId, projectId };

      const worlds = yield* leasedWorlds({
        checkout: (_thread, root) =>
          Effect.succeed(checkoutWorld({ projectRoot: root, scratch: `${root}/.scratch`, world: makeMachineWorld(() => null) })),
        hosts: [{ kind: 'sandbox', world: () => Effect.succeed(guestWorld()) }],
        place: () => Effect.succeed(PROVEN),
      });
      const inGuest: ReturnType<typeof asWorldAcquire> = (request) =>
        worlds.of({ thread: { id: threadId, hostKind: 'sandbox', hostId: 's1' }, at: request.at, root: request.root });

      const opened = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, inGuest);
      expect(opened.world.kind).toBe('sandbox');
      expect(opened.target.workingRoot).toBe('/work');
      expect(opened.target.workingRoot).not.toBe(checkout);
      expect(opened.target.place).toBeNull();
      expect(opened.target.sourceKey).toBe('intrinsic');

      const here = yield* worlds.of({ thread: { id: 'local', hostKind: null, hostId: null }, at: at('local', 'run-1', 0), root: checkout });
      expect(here.place).toEqual(PROVEN);

      const rebuilt = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, inGuest);
      expect(rebuilt.target).toEqual(opened.target);
      expect(rebuilt.world).toBe(opened.world);

      const root = yield* registerRoot(held, worktree);
      yield* held.units.write('TargetContexts', (unit) =>
        held.assignments.select(unit, {
          actor: operator,
          threadId,
          root: { rootId: root.rootId, locationRevision: root.locationRevision },
        }),
      );
      const prepared = yield* held.contexts.prepare(
        { thread, runId: 'run-1', fromGeneration: WorkspaceGeneration.make(0), requestId: 'req-1' },
        inGuest,
      );
      expect(prepared.world.root).toBe('/work');
      expect(prepared.target.workingRoot).toBe('/work');
      expect(prepared.target.workingRoot).not.toBe(root.path);
      expect(prepared.target.place).toBeNull();
    }).pipe(Effect.provide(layers)),
);

it.live('a registration retired under a standing selection refuses as gone rather than as cleared, and admits no generation', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'retired', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const thread = { id: threadId, projectId };
    const opened = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread));

    const root = yield* registerRoot(held, worktree);
    yield* held.units.write('TargetContexts', (unit) =>
      held.assignments.select(unit, {
        actor: operator,
        threadId,
        root: { rootId: root.rootId, locationRevision: root.locationRevision },
      }),
    );
    const records = yield* fileRootStore(held.db, held.units);
    yield* held.units.write('TargetContexts', (unit) => records.retire(root, unit));

    const refused = yield* Effect.flip(
      held.contexts.prepare(
        { thread, runId: 'run-1', fromGeneration: WorkspaceGeneration.make(0), requestId: 'req-1' },
        acquire(held, thread),
      ),
    );
    expect(refused._tag).toBe('GateRefusal');
    expect((refused as { code: string }).code).toBe('target-no-destination');
    expect((refused as { reason: string }).reason).toContain('no longer registered');
    expect((refused as { reason: string }).reason).not.toContain('cleared');

    expect(yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 1), unit))).toBeUndefined();
    expect(yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 0), unit))).toEqual(opened.target);
  }).pipe(Effect.provide(layers)),
);

it.live('releasing a prepared generation lets go of its world alone: the tree, the registration and the admitted record all stand', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'released', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const thread = { id: threadId, projectId };
    const opened = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread));

    const root = yield* registerRoot(held, worktree);
    yield* held.units.write('TargetContexts', (unit) =>
      held.assignments.select(unit, {
        actor: operator,
        threadId,
        root: { rootId: root.rootId, locationRevision: root.locationRevision },
      }),
    );
    const prepared = yield* held.contexts.prepare(
      { thread, runId: 'run-1', fromGeneration: WorkspaceGeneration.make(0), requestId: 'req-1' },
      acquire(held, thread),
    );
    yield* held.worlds.release(at(threadId, 'run-1', 1));

    expect(yield* held.files.exists(root.path)).toBe(true);
    expect((yield* held.units.read((unit) => held.roots.checked(root.rootId, undefined, unit))).path).toBe(root.path);
    expect(yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 0), unit))).toEqual(opened.target);

    const restored = yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, acquire(held, thread));
    expect(restored.world.root).toBe(checkout);
    const unpublished = yield* held.contexts.of(
      thread,
      { kind: 'run', runId: 'run-1', context: { generation: 1, sourceKey: prepared.ask.sourceKey, requestId: 'req-1' } },
      acquire(held, thread),
    );
    expect(unpublished.world).not.toBe(prepared.world);
    expect(unpublished.world.root).toBe(root.path);
    expect(yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 1), unit))).toBeUndefined();
    const elsewhere = yield* Effect.flip(
      held.contexts.of(
        thread,
        { kind: 'run', runId: 'run-1', context: { generation: 1, sourceKey: 'root:another', requestId: 'req-1' } },
        acquire(held, thread),
      ),
    );
    expect((elsewhere as { code: string }).code).toBe('target-unrecorded');

    const again = yield* held.contexts.prepare(
      { thread, runId: 'run-1', fromGeneration: WorkspaceGeneration.make(0), requestId: 'req-2' },
      acquire(held, thread),
    );
    expect(again.world).not.toBe(prepared.world);
    expect(again.world.root).toBe(root.path);
  }).pipe(Effect.provide(layers)),
);

it.live(
  'a generation records the tree it works, the binding proved for it and the graph copy it answers to as three facts, and the row carries all three',
  () =>
    Effect.gen(function* () {
      const held = yield* fixture;
      const checkout = yield* directory(held, 'checkout');
      const worktree = yield* directory(held, 'worktree');
      const projectId = yield* registerProject(held.db, 'coordinates', checkout);
      const threadId = yield* born(held, projectId);
      yield* running(held.db, threadId, 'run-1');
      const thread = { id: threadId, projectId };

      const worlds = yield* leasedWorlds({
        checkout: (_thread, root) =>
          Effect.succeed(checkoutWorld({ projectRoot: root, scratch: `${root}/.scratch`, world: makeMachineWorld(() => null) })),
        hosts: [],
        place: () => Effect.succeed(PROVEN),
      });
      const proving: ReturnType<typeof asWorldAcquire> = (request) =>
        worlds.of({ thread: { id: threadId, hostKind: null, hostId: null }, at: request.at, root: request.root });

      yield* held.contexts.of(thread, { kind: 'run', runId: 'run-1', context: null }, proving);
      const root = yield* registerRoot(held, worktree);
      yield* held.units.write('TargetContexts', (unit) =>
        held.assignments.select(unit, {
          actor: operator,
          threadId,
          root: { rootId: root.rootId, locationRevision: root.locationRevision },
        }),
      );
      const prepared = yield* held.contexts.prepare(
        { thread, runId: 'run-1', fromGeneration: WorkspaceGeneration.make(0), requestId: 'req-1' },
        proving,
      );
      expect(prepared.target.workingRoot).toBe(root.path);
      expect(prepared.target.place).toEqual(PROVEN);
      expect(prepared.target.graph).toEqual({ projectId, root: root.path });

      yield* held.units.write('TargetContexts', (unit) => Effect.orDie(prepared.ask.commit!(unit)));
      const stored = yield* held.units.read((unit) => held.targets.at(at(threadId, 'run-1', 1), unit));
      expect(stored).toEqual(prepared.target);
      expect(rootOf(prepared.target)).toEqual({ ...PROVEN, generation: WorkspaceGeneration.make(1) });
    }).pipe(Effect.provide(layers)),
);
