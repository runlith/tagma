import { fixtureMigrations } from '../migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ThreadCallBroke, type ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import { ThreadContextConflictError, type ThreadContextAnswer, type ThreadContextAsk } from '@runlith/agent/thread/run/ThreadRunContexts';
import { Clock, Effect, Fiber, Layer, Path, Schema, FileSystem } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { WorldUnavailable } from '../../../executions/contract/service/worlds.js';
import { project, projectsLayer } from '../../../projects/testing/doubles.js';
import { threadEntry, threadRun } from '../../../threads/testing/doubles.js';
import { MachineStore, type StoreDb, type StoreFailure } from '../../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { fixtureHome } from '../../../platform/testing/roots.js';
import { SelectionRevision, type AssignmentActor } from '../../../workspace/contract/wire/assignments.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import { threadTargetOperationKey } from '../../../threads/testing/doubles.js';
import { threadParts, type ThreadParts } from '../threadParts.js';
import { threadStore, targetSnapshotStore, type ThreadStore } from '../../../native-harness/testing/doubles.js';
import { TargetSnapshots } from '../../../threads/contract/service/targetSnapshots.js';
import { TargetPreparation } from '../../../threads/contract/service/preparation.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { targetContexts } from '../../../threads/testing/doubles.js';
import { asWorldAcquire } from '../../../threads/testing/doubles.js';
import { threadTargets, asThreadTargetKernel } from '../../../threads/testing/doubles.js';
import { checkoutWorld } from '../../../executions/testing/doubles.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import type { Worlds } from '../../../executions/contract/service/worlds.js';
import { leasedWorlds } from '../../../executions/testing/doubles.js';
import { assignmentStore } from '../../../workspace/testing/doubles.js';
import { assignmentLedger } from '../../../workspace/testing/doubles.js';
import { fileRootStore } from '../../../workspace/testing/doubles.js';
import { rootRegistry } from '../../../workspace/testing/doubles.js';
import { FileRoots, type RootReservations } from '../../../workspace/contract/service/roots.js';
import { Assignments } from '../../../workspace/contract/service/assignments.js';

import { lineageOver } from '../../../workspace/testing/lineage.js';
import { ENTRY_KINDS } from '../../manifest.js';

const namespaceId = NamespaceId.make('test-target-moves');
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
  readonly moves: Effect.Success<ReturnType<typeof threadTargets>>;
  readonly contexts: Effect.Success<ReturnType<typeof targetContexts>>;
  readonly worlds: Worlds['Service'];
  readonly home: string;
  readonly facets: Map<string, { readonly projectId: number; readonly hostKind: string | null }>;
  readonly creations: Map<string, { readonly operationId: string; readonly rootId: string | null }>;
  readonly calls: { runId: string; ask: ThreadContextAsk<WriteUnit<'machine'>> }[];
  answers:
    | ThreadContextAnswer[]
    | ((runId: string, ask: ThreadContextAsk<WriteUnit<'machine'>>) => Effect.Effect<ThreadContextAnswer, ThreadBorderFailed>);
};

const kernelOf = (held: Owned): ReturnType<typeof asThreadTargetKernel> => ({
  request: (runId, ask) => {
    held.calls.push({ runId, ask });
    if (typeof held.answers === 'function') return held.answers(runId, ask);
    const answer = held.answers.shift();
    if (answer === undefined) return Effect.die(new Error('the test kernel ran out of answers'));
    return Effect.succeed(answer);
  },
});

const accepted = (requestId: string, fromGeneration: number): ThreadContextAnswer => ({
  status: 'accepted',
  requestId,
  fromGeneration,
});
const published = (requestId: string, generation: number): ThreadContextAnswer => ({
  status: 'published',
  requestId,
  generation,
});
const denied = (requestId: string, detail: string): ThreadContextAnswer => ({
  status: 'denied',
  requestId,
  detail,
});
const conflicted = (threadId: string, runId: string, requestId: string, reason: string): ThreadBorderFailed =>
  new ThreadCallBroke({ cause: new ThreadContextConflictError({ threadId, runId, requestId, reason }) });
const noRun = (runId: string, threadId: string): ThreadBorderFailed =>
  new ThreadCallBroke({ cause: new Error(`No run of ${threadId} is going; a context change is asked of a run.`) });

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'moves-' });
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
  const contexts = yield* targetContexts().pipe(
    Effect.provideService(TargetSnapshots, targets),
    Effect.provideService(Assignments, assignments),
    Effect.provideService(FileRoots, roots),
  );
  const held = {
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
    home,
    facets: new Map<string, { readonly projectId: number; readonly hostKind: string | null }>(),
    creations: new Map<string, { readonly operationId: string; readonly rootId: string | null }>(),
    calls: [] as Owned['calls'],
    answers: [] as Owned['answers'],
  };
  return {
    ...held,
    contexts,
    moves: yield* threadTargets({
      threads: { facetOf: (threadId) => Effect.succeed(held.facets.get(threadId)) },
      creations: { of: (operationId) => Effect.succeed(held.creations.get(operationId) ?? null) },
    }).pipe(
      Effect.provideService(Assignments, assignments),
      Effect.provideService(TargetPreparation, contexts),
      Effect.provideService(TargetSnapshots, targets),
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

const born = (held: Owned, projectId: number, hostKind: string | null = null) =>
  held.units.write('ThreadTargets.born', (unit) =>
    Effect.gen(function* () {
      const row = yield* held.kernel.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
      yield* held.threads.rows.attachFacet({ threadId: row.id, projectId }, unit);
      held.facets.set(row.id, { projectId, hostKind });
      return ThreadId.make(row.id);
    }),
  );

const running = (db: StoreDb<'machine'>, threadId: string, runId: string): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(db.insert(threadRun()).values({ id: runId, threadId, ownerId: 'operator', status: 'running' }));

const publishedLog = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  input: { threadId: string; runId: string; ord: number; generation: number; sourceKey: string },
) {
  yield* db.insert(threadEntry()).values({
    threadId: input.threadId,
    ord: input.ord,
    entryId: `context-change:${input.runId}:req-${input.generation}`,
    runId: input.runId,
    type: 'context-change',
    entry: {
      type: 'context-change',
      id: `context-change:${input.runId}:req-${input.generation}`,
      runId: input.runId,
      requestId: `req-${input.generation}`,
      sourceKey: input.sourceKey,
      status: 'published',
      fromGeneration: input.generation - 1,
      generation: input.generation,
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    },
  });
});

const directory = (held: Owned, name: string): Effect.Effect<string, never> =>
  Effect.map(Effect.orDie(held.files.makeDirectory(held.paths.join(held.home, name), { recursive: true })), () =>
    held.paths.join(held.home, name),
  );

const registerRoot = (held: Owned, path: string) => held.roots.register({ path, provenance: { kind: 'test', id: 'moves' } });

const acquire =
  (held: Owned, threadId: string): ReturnType<typeof asWorldAcquire> =>
  (request) =>
    held.worlds.of({ thread: { id: threadId, hostKind: null, hostId: null }, ...request });

const callerOf = (projectId: number) => ({ projectId, actor: operator });

const key = Schema.decodeUnknownEffect(threadTargetOperationKey());

it.live('with no run going a move selects at once, creates none, and the same key reads the standing outcome', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'idle', checkout);
    const threadId = yield* born(held, projectId);
    const caller = callerOf(projectId);
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };

    const root = yield* registerRoot(held, worktree);
    const moved = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-a'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      ports,
    );
    expect(moved.status).toBe('selected');
    expect(yield* held.units.read((unit) => held.targets.readActive(threadId, unit))).toEqual({
      state: 'unavailable',
      reason: 'no-run',
    });
    const revision = (moved as { revision: number }).revision;
    expect(typeof revision).toBe('number');

    const again = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-a'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      ports,
    );
    expect(again).toEqual(moved);

    const elsewhere = yield* registerRoot(held, yield* directory(held, 'elsewhere'));
    const refused = yield* Effect.flip(
      held.moves.change(
        caller,
        { threadId, operationKey: yield* key('move-a'), root: { rootId: elsewhere.rootId, locationRevision: elsewhere.locationRevision } },
        ports,
      ),
    );
    expect(refused._tag).toBe('GateRefusal');
    expect((refused as { code: string }).code).toBe('changed-payload');

    expect(yield* held.moves.read(caller, { threadId }, ports)).toMatchObject({ state: 'selected', revision });
    expect(yield* held.moves.read(caller, { threadId, operationKey: yield* key('move-a') }, ports)).toMatchObject({
      state: 'selected',
      revision,
    });
    const missing = yield* Effect.flip(held.moves.read(caller, { threadId, operationKey: yield* key('nobody') }, ports));
    expect((missing as { code: string }).code).toBe('not-found');
  }).pipe(Effect.provide(layers)),
);

it.live('a move decided against an overtaken selection refuses, and selects nothing', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'stale', checkout);
    const threadId = yield* born(held, projectId);
    const caller = callerOf(projectId);
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };

    const before = yield* held.units.read((unit) => held.assignments.read(unit, threadId));
    const root = yield* registerRoot(held, worktree);
    const refused = yield* Effect.flip(
      held.moves.change(
        caller,
        {
          threadId,
          operationKey: yield* key('move-old'),
          expectedSelectionRevision: SelectionRevision.make(before.selection.revision + 1),
          root: { rootId: root.rootId, locationRevision: root.locationRevision },
        },
        ports,
      ),
    );
    expect((refused as { code: string }).code).toBe('stale-revision');
    const after = yield* held.units.read((unit) => held.assignments.read(unit, threadId));
    expect(after.selection.revision).toBe(before.selection.revision);
    expect(after.selection.rootId).toBe(before.selection.rootId);
    const missing = yield* Effect.flip(held.moves.read(caller, { threadId, operationKey: yield* key('move-old') }, ports));
    expect((missing as { code: string }).code).toBe('not-found');
  }).pipe(Effect.provide(layers)),
);

it.live('a thread reaching past what it may is denied, and the operator is not', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'denied', checkout);
    const threadId = yield* born(held, projectId);
    const stranger = yield* born(held, projectId);
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const root = yield* registerRoot(held, worktree);

    const refused = yield* Effect.flip(
      held.moves.change(
        { projectId, actor: { kind: 'thread', threadId: stranger } },
        { threadId, operationKey: yield* key('move-stranger'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
        ports,
      ),
    );
    expect((refused as { code: string }).code).toBe('denied');

    const moved = yield* held.moves.change(
      callerOf(projectId),
      { threadId, operationKey: yield* key('move-operator'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      ports,
    );
    expect(moved.status).toBe('selected');
  }).pipe(Effect.provide(layers)),
);

it.live('a running run answers pending before its next destination is published', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'pending', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const caller = callerOf(projectId);
    held.answers = [accepted('move-b', 0)];
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };

    const opened = yield* held.contexts.of(
      { id: threadId, projectId },
      { kind: 'run', runId: 'run-1', context: null },
      acquire(held, threadId),
    );
    expect(opened.target.generation).toBe(WorkspaceGeneration.make(0));

    const root = yield* registerRoot(held, worktree);
    const moved = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-b'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      ports,
    );
    expect(moved).toEqual({
      status: 'pending',
      operationKey: yield* key('move-b'),
      requestId: 'move-b',
      fromGeneration: WorkspaceGeneration.make(0),
    });
    expect(
      yield* held.units.read((unit) => held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(1) }, unit)),
    ).toBeUndefined();
  }).pipe(Effect.provide(layers)),
);

it.live('a published move replays applied, and the read answers the committed tree', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'applied', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const caller = callerOf(projectId);
    held.answers = [accepted('move-c', 0), published('move-c', 1)];
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    yield* held.contexts.of({ id: threadId, projectId }, { kind: 'run', runId: 'run-1', context: null }, acquire(held, threadId));

    const root = yield* registerRoot(held, worktree);
    expect(
      yield* held.moves.change(
        caller,
        { threadId, operationKey: yield* key('move-c'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
        ports,
      ),
    ).toMatchObject({ status: 'pending' });

    yield* held.units.write('ThreadTargets', (unit) => Effect.orDie(held.calls[0]!.ask.commit!(unit)));
    yield* publishedLog(held.db, {
      threadId,
      runId: 'run-1',
      ord: 1,
      generation: 1,
      sourceKey: `root:${root.rootId}`,
    });
    const replayed = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-c'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      ports,
    );
    expect(replayed).toEqual({ status: 'applied', operationKey: yield* key('move-c'), generation: WorkspaceGeneration.make(1) });

    const read = yield* held.moves.read(caller, { threadId }, ports);
    expect(read.state).toBe('effective');
    if (read.state === 'effective') {
      expect(read.target.workingRoot).toBe(root.path);
      expect(read.target.generation).toBe(WorkspaceGeneration.make(1));
    }
    const keyed = yield* held.moves.read(caller, { threadId, operationKey: yield* key('move-c') }, ports);
    expect(keyed.state).toBe('effective');
    if (keyed.state === 'effective') expect(keyed.target.workingRoot).toBe(root.path);
    const kept = yield* held.units.read((unit) =>
      held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(0) }, unit),
    );
    expect(kept?.workingRoot).toBe(checkout);
  }).pipe(Effect.provide(layers)),
);

it.live('the boundary composes the moved generation before it is published, and the commit records that same destination', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'boundary', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    held.answers = [accepted('move-next', 0)];
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    yield* held.contexts.of({ id: threadId, projectId }, { kind: 'run', runId: 'run-1', context: null }, acquire(held, threadId));

    const root = yield* registerRoot(held, worktree);
    expect(
      yield* held.moves.change(
        callerOf(projectId),
        { threadId, operationKey: yield* key('move-next'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
        ports,
      ),
    ).toMatchObject({ status: 'pending' });

    const next = { generation: 1, sourceKey: `root:${root.rootId}`, requestId: 'move-next' };
    const composed = yield* held.contexts.of(
      { id: threadId, projectId },
      { kind: 'run', runId: 'run-1', context: next },
      acquire(held, threadId),
    );
    expect(composed.world.root).toBe(root.path);
    expect(composed.target.generation).toBe(WorkspaceGeneration.make(1));

    yield* held.units.write('ThreadTargets', (unit) => Effect.orDie(held.calls[0]!.ask.commit!(unit)));
    const recorded = yield* held.units.read((unit) =>
      held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(1) }, unit),
    );
    expect(recorded?.workingRoot).toBe(root.path);
    const restored = yield* held.contexts.of(
      { id: threadId, projectId },
      { kind: 'tools', runId: 'run-1', context: next },
      acquire(held, threadId),
    );
    expect(restored.target).toEqual(recorded!);

    const elsewhere = yield* Effect.flip(
      held.contexts.of(
        { id: threadId, projectId },
        { kind: 'run', runId: 'run-1', context: { generation: 2, sourceKey: `root:${root.rootId}`, requestId: 'never-asked' } },
        acquire(held, threadId),
      ),
    );
    expect((elsewhere as { code: string }).code).toBe('target-unrecorded');
  }).pipe(Effect.provide(layers)),
);

it.live('a move the boundary denied reads as failed, and the run still reads where it works', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'denied-boundary', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const caller = callerOf(projectId);
    held.answers = [accepted('move-denied', 0), denied('move-denied', 'the destination would not compose')];
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    yield* held.contexts.of({ id: threadId, projectId }, { kind: 'run', runId: 'run-1', context: null }, acquire(held, threadId));

    const root = yield* registerRoot(held, worktree);
    expect(
      yield* held.moves.change(
        caller,
        { threadId, operationKey: yield* key('move-denied'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
        ports,
      ),
    ).toMatchObject({ status: 'pending' });

    expect(yield* held.moves.read(caller, { threadId, operationKey: yield* key('move-denied') }, ports)).toMatchObject({
      state: 'failed',
      operationKey: 'move-denied',
    });
    const standing = yield* held.moves.read(caller, { threadId }, ports);
    expect(standing.state).toBe('effective');
    if (standing.state === 'effective') expect(standing.target.workingRoot).toBe(checkout);
  }).pipe(Effect.provide(layers)),
);

it.live('a move decided against an overtaken generation refuses before selecting', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'generation', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const caller = callerOf(projectId);
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    yield* held.contexts.of({ id: threadId, projectId }, { kind: 'run', runId: 'run-1', context: null }, acquire(held, threadId));

    const root = yield* registerRoot(held, worktree);
    const refused = yield* Effect.flip(
      held.moves.change(
        caller,
        {
          threadId,
          operationKey: yield* key('move-future'),
          expectedGeneration: WorkspaceGeneration.make(3),
          root: { rootId: root.rootId, locationRevision: root.locationRevision },
        },
        ports,
      ),
    );
    expect((refused as { code: string }).code).toBe('stale-generation');
  }).pipe(Effect.provide(layers)),
);

it.live('a second move while one stands fails, and the old generation is untouched by it', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const first = yield* directory(held, 'first');
    const second = yield* directory(held, 'second');
    const projectId = yield* registerProject(held.db, 'conflict', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const caller = callerOf(projectId);
    held.answers = [accepted('move-d', 0)];
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const opened = yield* held.contexts.of(
      { id: threadId, projectId },
      { kind: 'run', runId: 'run-1', context: null },
      acquire(held, threadId),
    );

    const one = yield* registerRoot(held, first);
    expect(
      yield* held.moves.change(
        caller,
        { threadId, operationKey: yield* key('move-d'), root: { rootId: one.rootId, locationRevision: one.locationRevision } },
        ports,
      ),
    ).toMatchObject({ status: 'pending' });

    const two = yield* registerRoot(held, second);
    held.answers = (_runId, ask) =>
      Effect.fail(conflicted(threadId, 'run-1', ask.requestId, 'This run is already changing context under request move-d.'));
    const failed = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-e'), root: { rootId: two.rootId, locationRevision: two.locationRevision } },
      ports,
    );
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') expect(failed.detail).toContain('already changing context');

    const reread = yield* held.moves.read(caller, { threadId, operationKey: yield* key('move-e') }, ports);
    expect(reread).toMatchObject({ state: 'failed', operationKey: 'move-e' });
    expect(
      yield* held.units.read((unit) => held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(0) }, unit)),
    ).toEqual(opened.target);
    expect(
      yield* held.units.read((unit) => held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(1) }, unit)),
    ).toBeUndefined();
  }).pipe(Effect.provide(layers)),
);

it.live('a run that ends before the boundary fails the move, and the opening is still readable as itself', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'settled', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const caller = callerOf(projectId);
    held.answers = [accepted('move-f', 0)];
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const opened = yield* held.contexts.of(
      { id: threadId, projectId },
      { kind: 'run', runId: 'run-1', context: null },
      acquire(held, threadId),
    );

    const root = yield* registerRoot(held, worktree);
    expect(
      yield* held.moves.change(
        caller,
        { threadId, operationKey: yield* key('move-f'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
        ports,
      ),
    ).toMatchObject({ status: 'pending' });

    held.answers = (_runId, _ask) => Effect.fail(noRun('run-1', threadId));
    const replayed = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-f'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      ports,
    );
    expect(replayed.status).toBe('failed');
    expect(
      yield* held.units.read((unit) => held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(0) }, unit)),
    ).toEqual(opened.target);
    expect(yield* held.moves.read(caller, { threadId, operationKey: yield* key('move-f') }, ports)).toMatchObject({
      state: 'failed',
      operationKey: 'move-f',
    });
  }).pipe(Effect.provide(layers)),
);

it.live('a thread born against a host gains no registered local root', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'guest-move', checkout);
    const threadId = yield* born(held, projectId, 'sandbox');
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const root = yield* registerRoot(held, worktree);

    const before = yield* held.units.read((unit) => held.assignments.read(unit, threadId));
    const refused = yield* Effect.flip(
      held.moves.change(
        callerOf(projectId),
        { threadId, operationKey: yield* key('move-guest'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
        ports,
      ),
    );
    expect((refused as { code: string }).code).toBe('guest-mobility');
    const placement = yield* held.units.read((unit) => held.assignments.read(unit, threadId));
    expect(placement.selection.provenance).toBe('intrinsic');
    expect(placement.selection.revision).toBe(before.selection.revision);
    const missing = yield* Effect.flip(held.moves.read(callerOf(projectId), { threadId, operationKey: yield* key('move-guest') }, ports));
    expect((missing as { code: string }).code).toBe('not-found');
  }).pipe(Effect.provide(layers)),
);

it.live('a caller under another project sees neither the move nor its replay', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const otherRoot = yield* directory(held, 'other');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'home', checkout);
    const foreignId = yield* registerProject(held.db, 'away', otherRoot);
    const threadId = yield* born(held, projectId);
    const caller = callerOf(projectId);
    const stranger = callerOf(foreignId);
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const root = yield* registerRoot(held, worktree);

    const moved = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-home'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      ports,
    );
    expect(moved.status).toBe('selected');

    const refused = yield* Effect.flip(
      held.moves.change(
        stranger,
        { threadId, operationKey: yield* key('move-home'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
        ports,
      ),
    );
    expect((refused as { code: string }).code).toBe('foreign-project');
    const reread = yield* Effect.flip(held.moves.read(stranger, { threadId, operationKey: yield* key('move-home') }, ports));
    expect((reread as { code: string }).code).toBe('foreign-project');
    expect(yield* held.moves.read(caller, { threadId, operationKey: yield* key('move-home') }, ports)).toMatchObject({
      state: 'selected',
    });
  }).pipe(Effect.provide(layers)),
);

it.live('a stranger replaying another move is denied', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'replay-auth', checkout);
    const threadId = yield* born(held, projectId);
    const stranger = yield* born(held, projectId);
    const caller = callerOf(projectId);
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const root = yield* registerRoot(held, worktree);

    const moved = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-mine'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      ports,
    );
    expect(moved.status).toBe('selected');

    const refused = yield* Effect.flip(
      held.moves.change(
        { projectId, actor: { kind: 'thread', threadId: stranger } },
        { threadId, operationKey: yield* key('move-mine'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
        ports,
      ),
    );
    expect((refused as { code: string }).code).toBe('denied');
  }).pipe(Effect.provide(layers)),
);

it.live('a world that will not open fails the move and keeps the admitted generation', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'dark-world', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const caller = callerOf(projectId);
    held.answers = [accepted('move-dark', 0)];
    const opened = yield* held.contexts.of(
      { id: threadId, projectId },
      { kind: 'run', runId: 'run-1', context: null },
      acquire(held, threadId),
    );
    const root = yield* registerRoot(held, worktree);
    const dark = {
      kernel: kernelOf(held),
      acquire: () => Effect.fail(new WorldUnavailable({ threadId, hostKind: null, reason: 'the test closed this world' })),
    };
    const failed = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-dark'), root: { rootId: root.rootId, locationRevision: root.locationRevision } },
      dark,
    );
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') expect(failed.detail).toContain('closed this world');
    expect(
      yield* held.units.read((unit) => held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(0) }, unit)),
    ).toEqual(opened.target);
    expect(
      yield* held.units.read((unit) => held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(1) }, unit)),
    ).toBeUndefined();
    expect(yield* held.moves.read(caller, { threadId, operationKey: yield* key('move-dark') }, dark)).toMatchObject({
      state: 'failed',
      operationKey: 'move-dark',
    });
  }).pipe(Effect.provide(layers)),
);

it.live('a selection that moves under a pending move fails its replay, and the opening stands', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const first = yield* directory(held, 'first');
    const second = yield* directory(held, 'second');
    const projectId = yield* registerProject(held.db, 'overtaken', checkout);
    const threadId = yield* born(held, projectId);
    yield* running(held.db, threadId, 'run-1');
    const caller = callerOf(projectId);
    held.answers = [accepted('move-first', 0)];
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const opened = yield* held.contexts.of(
      { id: threadId, projectId },
      { kind: 'run', runId: 'run-1', context: null },
      acquire(held, threadId),
    );

    const one = yield* registerRoot(held, first);
    expect(
      yield* held.moves.change(
        caller,
        { threadId, operationKey: yield* key('move-first'), root: { rootId: one.rootId, locationRevision: one.locationRevision } },
        ports,
      ),
    ).toMatchObject({ status: 'pending' });

    const two = yield* registerRoot(held, second);
    held.answers = [accepted('move-second', 0)];
    expect(
      yield* held.moves.change(
        caller,
        { threadId, operationKey: yield* key('move-second'), root: { rootId: two.rootId, locationRevision: two.locationRevision } },
        ports,
      ),
    ).toMatchObject({ status: 'pending' });

    const replayed = yield* held.moves.change(
      caller,
      { threadId, operationKey: yield* key('move-first'), root: { rootId: one.rootId, locationRevision: one.locationRevision } },
      ports,
    );
    expect(replayed.status).toBe('failed');
    if (replayed.status === 'failed') expect(replayed.detail).toContain('overtaken');
    expect(
      yield* held.units.read((unit) => held.targets.at({ threadId, runId: 'run-1', generation: WorkspaceGeneration.make(0) }, unit)),
    ).toEqual(opened.target);
  }).pipe(Effect.provide(layers)),
);

it.live('two callers meeting on one key converge: one selection, one standing outcome', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'converge', checkout);
    const threadId = yield* born(held, projectId);
    const caller = callerOf(projectId);
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const root = yield* registerRoot(held, worktree);
    const binding = { rootId: root.rootId, locationRevision: root.locationRevision };
    const before = yield* held.units.read((unit) => held.assignments.read(unit, threadId));

    const [a, b] = yield* Effect.gen(function* () {
      const one = yield* Effect.forkChild(held.moves.change(caller, { threadId, operationKey: yield* key('race'), root: binding }, ports));
      const two = yield* Effect.forkChild(held.moves.change(caller, { threadId, operationKey: yield* key('race'), root: binding }, ports));
      return yield* Effect.all([Fiber.join(one), Fiber.join(two)]);
    });
    expect(a.status).toBe('selected');
    expect(b).toEqual(a);
    const after = yield* held.units.read((unit) => held.assignments.read(unit, threadId));
    expect(after.selection.revision - before.selection.revision).toBe(1);
    expect(after.selection.rootId).toBe(root.rootId);
  }).pipe(Effect.provide(layers)),
);

it.live('a move enters only a recorded creation, and reads it without running anything', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const checkout = yield* directory(held, 'checkout');
    const worktree = yield* directory(held, 'worktree');
    const projectId = yield* registerProject(held.db, 'creation', checkout);
    const threadId = yield* born(held, projectId);
    const caller = callerOf(projectId);
    const ports = { kernel: kernelOf(held), acquire: acquire(held, threadId) };
    const root = yield* registerRoot(held, worktree);

    const unknown = yield* Effect.flip(
      held.moves.change(
        caller,
        {
          threadId,
          operationKey: yield* key('move-made'),
          root: { rootId: root.rootId, locationRevision: root.locationRevision },
          creationOperationId: 'never-made',
        },
        ports,
      ),
    );
    expect((unknown as { code: string }).code).toBe('creation-unknown');

    held.creations.set('made-once', { operationId: 'made-once', rootId: root.rootId });
    const moved = yield* held.moves.change(
      caller,
      {
        threadId,
        operationKey: yield* key('move-made'),
        root: { rootId: root.rootId, locationRevision: root.locationRevision },
        creationOperationId: 'made-once',
      },
      ports,
    );
    expect(moved.status).toBe('selected');

    held.creations.set('made-elsewhere', { operationId: 'made-elsewhere', rootId: 'root:elsewhere' });
    const mismatched = yield* Effect.flip(
      held.moves.change(
        caller,
        {
          threadId,
          operationKey: yield* key('move-borrowed'),
          root: { rootId: root.rootId, locationRevision: root.locationRevision },
          creationOperationId: 'made-elsewhere',
        },
        ports,
      ),
    );
    expect((mismatched as { code: string }).code).toBe('creation-mismatch');
    const missing = yield* Effect.flip(held.moves.read(caller, { threadId, operationKey: yield* key('move-borrowed') }, ports));
    expect((missing as { code: string }).code).toBe('not-found');
  }).pipe(Effect.provide(layers)),
);
