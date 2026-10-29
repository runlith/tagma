import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { Cause, Clock, Context, Deferred, Effect, Exit, FiberSet, Option, Scope, Semaphore } from 'effect';
import type { TicketClass } from '@runlith/held/Capacity';
import { Holding, liveHolds, liveTickets } from '@runlith/held/holding';
import { CapacityBusy, HoldStalled } from '@runlith/held/failures';
import { Capacity } from '../../platform/contract/service/capacity.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { OPEN_FOR_CALL, OPEN_IN_BACKGROUND } from '../contract/service/lanes.js';
import { type Copies, type Copy, CopyKeeping, makeCopies, sameRegistration } from './copies.js';
import { makePlaces, type Placed } from './places.js';
import { MachineStore, GraphStore } from '../../platform/contract/service/store.js';
import { meta } from '../store/tables.js';
import { canon, ShadowGit } from '../tree/shadow.js';
import { resolveStorageLayout, type StorageLayout, storageHomes } from '../storage/layout.js';
import { actingTrees, closedTrees, heldFlush, servedStealth, sharedLayer } from './stealth.js';
import { judgeKept } from '../blocks/layerLaw.js';
import { BlockNames } from '../contract/service/acts.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { GateRefusal, refusalBody, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { Git } from '@runlith/git/Git';
import { commitOf } from '@runlith/git/repository';
import { runGit } from '../../platform/git/ownGit.js';
import { Tags } from '../contract/service/vocabulary.js';
import { heldTasks } from '../work/tasksHeld.js';
import { NATIVE_HARNESS, sessionToken } from '../../platform/contract/wire/session.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { ProjectChanges } from '../../projects/contract/service/changes.js';
import { blocksRetiredKey } from '../contract/wire/storage.js';
import { makeBranchChanges } from './branchChanges.js';
import {
  MirrorBuilder,
  ProjectPolicy,
  ServedGraphs,
  ServedStorage,
  ServingSwitch,
  TaskHolders,
  type CopyAim,
  type CopyPlace,
  type HeldGraph,
  type IndexedCopy,
  type IndexedTitle,
  type ServedGraph,
} from '../contract/service/serving.js';
import type { UnreadableCopy } from '../contract/wire/titles.js';
import { makeFreshnessGate } from './freshness.js';
import { makeMirrorBuilder } from './open.js';
import { makeMergeFormat } from './mergeFormat.js';
import { refused } from './refusal.js';
import { entryGateKey, mirrorGateKey, overEntry, overRepositoryAndTree, overTree } from './permits.js';
import { makeServingSwitch } from './checkout.js';
import { makeRecoveries } from './recovery.js';
import { makeGraphRemotes } from './remotes.js';
import { makeTwinning } from './twinning.js';
import { writes } from '../../platform/contract/service/writes.js';
import { copyIndex } from './copyIndex.js';
import { makeForeignBlocks } from './foreign.js';
import { GraphSteps } from '../contract/service/steps.js';
import { checkoutsOf } from '../../workspace/checkouts/git.js';

const lettingGo = writes('GraphPool.letGo', [meta]);

type Opened = CopyPlace & { readonly done: Deferred.Deferred<void> };

const closedRefusal = () =>
  new GateRefusal('graph-pool', 'the graph pool closed, so nothing opens on it any more', ['resolve against the server that stands now']);

export const makeGraphPool = Effect.gen(function* () {
  const git = yield* Git;
  const policy = yield* ProjectPolicy;
  const machineStore = yield* MachineStore;
  const steps = yield* GraphSteps;
  const keeping = yield* CopyKeeping;
  const capacity = yield* Capacity;
  const checkoutRows = yield* CheckoutRows;
  const clock = yield* Clock.Clock;
  const gates = new Map<string, Semaphore.Semaphore>();
  const opening = new Map<string, Opened>();
  const copyIndexReader = copyIndex();
  let closed = false;

  const gate = (key: string) => {
    const held = gates.get(key);
    if (held !== undefined) return held;
    const made = Semaphore.makeUnsafe(1);
    gates.set(key, made);
    return made;
  };
  const mirrorBuilder = yield* makeMirrorBuilder({ gates: gate });
  const mergeFormat = yield* makeMergeFormat.pipe(Effect.provideService(MirrorBuilder, mirrorBuilder));
  const freshnessGate = yield* makeFreshnessGate({
    gates: gate,
    storePath: machineStore.path,
    changed: (projectId) => remotes.wake(projectId),
  }).pipe(Effect.provideService(MirrorBuilder, mirrorBuilder));
  const servingSwitch = yield* makeServingSwitch.pipe(Effect.provideService(MirrorBuilder, mirrorBuilder));
  const recoveries = yield* makeRecoveries({ gates: gate, storePath: machineStore.path }).pipe(
    Effect.provideService(ServingSwitch, servingSwitch),
  );

  const warmScope = yield* Scope.make();
  const warmFork = yield* FiberSet.makeRuntime<never, void, never>().pipe(Effect.provideService(Scope.Scope, warmScope));
  const warming = new Set<number>();

  const keepScope = yield* Scope.make();
  const keepFork = yield* FiberSet.makeRuntime<never, void, never>().pipe(Effect.provideService(Scope.Scope, keepScope));

  const settledOpening = (treeRoot: string, settled: Opened) =>
    Effect.sync(() => {
      if (opening.get(treeRoot) === settled) opening.delete(treeRoot);
      Deferred.doneUnsafe(settled.done, Effect.void);
    });

  const flushedHeld = heldFlush(gate);

  const flushed = (treeRoot: string, entry: HeldGraph) => overRepositoryAndTree(gate, entry.layout)(flushedHeld(treeRoot, entry));

  const closeCopy = Effect.fn('GraphPool.close')(function* (copy: Copy) {
    yield* closedTrees(freshnessGate, copy.treeRoot, copy.graph);
    yield* overRepositoryAndTree(gate, copy.graph.layout)(Effect.andThen(flushedHeld(copy.treeRoot, copy.graph), copy.graph.dispose()));
  });

  const closing = (copy: Copy, due: () => boolean): Effect.Effect<void> =>
    Effect.flatMap(
      overEntry(
        gate,
        copy.treeRoot,
      )(
        Effect.uninterruptible(
          Effect.suspend(() => (due() && copies.unpublish(copy) ? Effect.as(closeCopy(copy), true) : Effect.succeed(false))),
        ),
      ),
      (gone) =>
        Effect.sync(() => {
          if (gone) copies.closed(copy);
        }),
    );

  const copies: Copies = makeCopies({
    keeping,
    clock,
    fork: (effect) => void keepFork(effect),
    lapse: (copy) => closing(copy, () => copies.lapsed(copy)),
  });

  const places = makePlaces({
    rows: checkoutRows,
    fork: (effect) => {
      const fiber = keepFork(effect);
      return () => fiber.interruptUnsafe();
    },
  });

  const dropAll = Effect.fnUntraced(function* (projectId: number) {
    warming.delete(projectId);
    places.forget(projectId);
    for (const copy of copies.letGo(projectId)) yield* closing(copy, () => true);
  });

  const releaseProject = (projectId: number) =>
    copies.exclusive(
      projectId,
      Effect.andThen(
        dropAll(projectId),
        Effect.sync(() => places.leave(projectId)),
      ),
    );

  const standsFor = (copy: Copy | undefined, placed: Placed): copy is Copy =>
    copy !== undefined &&
    copies.current(copy) &&
    copy.graph.projectId === placed.row.id &&
    copy.detachedAt === placed.detachedAt &&
    sameRegistration(copy.graph.project, placed.row);

  const viewOf = (copy: Copy, placed: Placed): ServedGraph =>
    placed.readOnly !== undefined && copy.detachedAt === null
      ? { ...copy.graph, checkout: placed.readOnly.checkout, readOnly: placed.readOnly }
      : copy.graph;

  const place = Effect.fnUntraced(function* (aim: CopyAim) {
    if (closed) return yield* closedRefusal();
    if (machineStore.path === ':memory:')
      return yield* new GateRefusal('graph-pool', 'an in-memory machine store has no home for trees or mirrors', [
        'open the store on a file',
      ]);
    const served = yield* servingSwitch.servedBy(aim);
    const layout = yield* refused(
      resolveStorageLayout({
        mode: served.row.storage,
        projectId: served.row.id,
        ...storageHomes(machineStore.path),
        worktree: served.checkout,
      }),
    );
    const own = served.readOnly !== undefined && served.readOnly.checkout === served.checkout;
    const detachedAt = own ? ((yield* refused(commitOf(git, served.checkout, 'HEAD'))) ?? served.checkout) : null;
    const placed: Placed = { ...served, layout, detachedAt };
    return placed;
  });

  const laned = Effect.fnUntraced(
    function* <A, E>(klass: TicketClass, work: Effect.Effect<A, E>): Effect.fn.Return<A, E | CapacityBusy | HoldStalled> {
      const phase = klass === 'background' ? OPEN_IN_BACKGROUND : OPEN_FOR_CALL;
      const holding = yield* Holding;
      const tickets = liveTickets(holding);
      if (tickets.some((ticket) => ticket.phase === phase.name)) return yield* work;
      if (liveHolds(holding).length === 0 && tickets.length === 0) return yield* capacity.ticket(phase, work);
      const release = yield* capacity.tryLease(phase);
      return yield* release === null ? work : Effect.ensuring(work, Effect.sync(release));
    },
    Effect.catchIf(
      (failure): failure is CapacityBusy | HoldStalled => failure instanceof CapacityBusy || failure instanceof HoldStalled,
      (failure) => Effect.fail(new GateRefusal('graph-pool', failure.message, ['open the graph again'])),
    ),
  );

  const acquire = Effect.fn('GraphPool.acquire')(function* <A>(
    placed: Placed,
    generation: number,
    how: { readonly rowsStep: string | null; readonly klass: TicketClass },
    seize: (copy: Copy) => A,
  ) {
    const treeRoot = placed.layout.treeRoot;
    for (;;) {
      const stale = copies.at(treeRoot);
      if (stale !== undefined && !standsFor(stale, placed)) yield* closing(stale, () => !standsFor(stale, placed));
      const outcome = yield* overEntry(
        gate,
        treeRoot,
      )(
        Effect.gen(function* () {
          const again = copies.at(treeRoot);
          if (standsFor(again, placed)) return { seized: seize(again) };
          if (again !== undefined) return null;
          if (closed) return yield* closedRefusal();
          const settled: Opened = { projectId: placed.row.id, checkout: placed.checkout, done: Deferred.makeUnsafe<void>() };
          opening.set(treeRoot, settled);
          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const opened = placed.detachedAt !== null;
              const graph = yield* restore(laned(how.klass, open(placed.row, placed.checkout, placed.layout, how.rowsStep, opened)));
              if (closed) {
                yield* graph.dispose();
                return yield* closedRefusal();
              }
              if (copies.generation(placed.row.id) !== generation) {
                yield* graph.dispose();
                return yield* new GateRefusal(
                  'graph-pool',
                  `project ${placed.row.id} let its graphs go while this one was opening, so what opened stands where the project no longer does`,
                  ['resolve again — the next open reads where the project now stands'],
                );
              }
              return { seized: seize(copies.publish(treeRoot, graph, generation, placed.detachedAt)) };
            }),
          ).pipe(Effect.ensuring(settledOpening(treeRoot, settled)));
        }),
      );
      if (outcome !== null) return outcome.seized;
    }
  });

  const ready = (aim: CopyAim): { readonly copy: Copy; readonly placed: Placed } | null => {
    if (closed || copies.changing(aim.projectId)) return null;
    const placed = places.known(aim);
    if (placed === undefined) return null;
    const copy = copies.at(placed.layout.treeRoot);
    return standsFor(copy, placed) ? { copy, placed } : null;
  };

  const reach = Effect.fnUntraced(function* <A>(aim: CopyAim, klass: TicketClass, seize: (copy: Copy) => A) {
    for (;;) {
      const fast = ready(aim);
      if (fast !== null) return { value: seize(fast.copy), view: viewOf(fast.copy, fast.placed) };
      const generation = copies.generation(aim.projectId);
      const epoch = places.epoch(aim.projectId);
      const placed = yield* place(aim);
      const admitted = yield* copies.admitted(placed.row.id, placed.row);
      if (admitted === null) {
        yield* copies.exclusive(
          placed.row.id,
          Effect.suspend(() => (copies.outlived(placed.row.id, placed.row) ? dropAll(placed.row.id) : Effect.void)),
        );
        continue;
      }
      if (admitted.generation !== generation) {
        admitted.done();
        continue;
      }
      places.remember(aim, placed, epoch);
      return yield* acquire(placed, admitted.generation, { rowsStep: null, klass }, (copy) => ({
        value: seize(copy),
        view: viewOf(copy, placed),
      })).pipe(Effect.ensuring(Effect.sync(admitted.done)));
    }
  });

  const within = Effect.fnUntraced(function* (projectId: number, rowsStep: string | null) {
    const placed = yield* place({ projectId });
    return yield* acquire(placed, copies.generation(projectId), { rowsStep, klass: 'call' }, (copy) => {
      copies.use(copy);
      return copy.graph;
    });
  });

  const resolve = (aim: CopyAim): Effect.Effect<ServedGraph, GateRefusal<OpenRefusal>> =>
    Effect.map(reach(aim, 'call', copies.use), (reached) => reached.view);

  const servingCopy = (place: CopyPlace): Copy | undefined => {
    const exact = copies.of(place);
    if (exact !== undefined) return exact;
    const placed = places.known({ projectId: place.projectId, cwd: place.checkout });
    const copy = placed === undefined ? undefined : copies.at(placed.layout.treeRoot);
    return placed !== undefined && standsFor(copy, placed) ? copy : undefined;
  };

  const seized = (copy: Copy, view: ServedGraph): Effect.Effect<ServedGraph | null, never, Scope.Scope> =>
    Effect.uninterruptible(
      Effect.suspend(() => {
        if (!copies.current(copy)) return Effect.succeed(null);
        const release = copies.hold(copy);
        return Effect.as(
          Effect.addFinalizer(() => Effect.sync(release)),
          view,
        );
      }),
    );

  const hold = Effect.fnUntraced(function* (aim: CopyAim): Effect.fn.Return<ServedGraph, GateRefusal<OpenRefusal>, Scope.Scope> {
    for (;;) {
      const reached = yield* reach(aim, 'call', (copy) => copy);
      const held = yield* seized(reached.value, reached.view);
      if (held !== null) return held;
    }
  });

  const open = Effect.fn('GraphPool.open')(function* (
    row: ProjectPolicyRow,
    checkout: string,
    layout: StorageLayout,
    rowsStep: string | null,
    detached: boolean,
  ): Effect.fn.Return<HeldGraph, GateRefusal<OpenRefusal>> {
    let dispose: Effect.Effect<void> | undefined;
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const prepared = detached
          ? yield* restore(
              Effect.gen(function* () {
                const repository = layout.mode === 'team' ? checkout : layout.gitDir;
                if (layout.mode === 'stealth') yield* refused(ShadowGit.open(repository, git, row.graphRemote));
                const source = layout.mode === 'team' || existsSync(layout.treeRoot) ? layout.treeRoot : repository;
                const commit = yield* refused(runGit(git, 'detached-graph-head', ['-C', source, 'rev-parse', 'HEAD']));
                return yield* mirrorBuilder.prepare({
                  row,
                  checkout,
                  repository,
                  commit,
                  graphPath: layout.mode === 'team' ? '.tagma' : '',
                  workingTree: layout.treeRoot,
                });
              }),
            )
          : undefined;
        if (prepared !== undefined) layout = prepared.layout;
        const acting = actingTrees(gate, freshnessGate, layout, {
          projectId: row.id,
          ...storageHomes(machineStore.path),
          worktree: checkout,
        });
        const built =
          prepared?.built ??
          (yield* restore(
            mirrorBuilder.build({
              rowsStep,
              row,
              checkout,
              layout,
              guard: acting.guard,
              settled: acting.settled,
              siblings: freshnessGate.siblings,
              resolveProject: Effect.fnUntraced(function* (projectId: number) {
                const served = yield* resolve({ projectId });
                yield* served.fresh();
                return served.context;
              }),
              committed: () => remotes.wake(row.id),
            }),
          ));
        const release = prepared?.release ?? Effect.promise(() => built.dispose());
        dispose = release;
        const context = built.context;
        return yield* restore(
          Effect.gen(function* () {
            const { stealth, both, unregister } = yield* servedStealth(freshnessGate, { checkout, row, layout, built });
            const layer =
              stealth === null || detached
                ? null
                : sharedLayer(stealth, () =>
                    copies
                      .all()
                      .flatMap((copy) =>
                        copy.graph.projectId === row.id && copy.graph.readOnly === undefined ? [copy.graph.stealth] : [],
                      ),
                  );
            yield* freshnessGate.settled(layout.treeRoot);
            if (!detached) remotes.opened(row, layout);
            const graph = Context.get(built.context, GraphStore);
            const tags = Context.get(built.context, Tags);
            const held: HeldGraph = {
              context: Context.add(
                context,
                TaskHolders,
                TaskHolders.of({
                  forHolders: Effect.fn('TaskHolders.forHolders')(function* (threadIds, writer) {
                    const table = yield* tags.of(row.id);
                    const held = yield* heldTasks(table, graph, row.id, threadIds);
                    if (writer === undefined) return held;
                    const own = yield* heldTasks(table, graph, row.id, [writer.key], writer.harness);
                    const holder = writer.harness === NATIVE_HARNESS ? writer.key : sessionToken(writer);
                    return new Map([...held, [holder, own.get(writer.key) ?? []]]);
                  }),
                }),
              ).pipe(Context.add(ServedStorage, layout.mode === 'stealth' ? { mode: 'stealth' } : { mode: 'team', stealth: layer })),
              git,
              layout,
              stealth,
              projectId: row.id,
              readOnly: detached ? { checkout, main: row.rootPath } : undefined,
              shadow: built.shadow,
              checkout,
              project: { repoKey: row.repoKey, rootPath: row.rootPath, storage: row.storage },
              batches: built.batches,
              checkoutChanged: built.checkoutChanged,
              fresh: () => both((treeRoot) => freshnessGate.fresh(treeRoot)),
              copyFailures: () => freshnessGate.copyFailures(layout.treeRoot),
              settled: (force = false) => both((treeRoot) => freshnessGate.settled(treeRoot, force)),
              dispose: Effect.fnUntraced(function* () {
                unregister();
                yield* release;
              }),
            };
            return held;
          }),
        );
      }),
    ).pipe(
      Effect.onError(() => {
        const release = dispose;
        return release ?? Effect.void;
      }),
    );
  });

  const indexedCopies = Effect.fnUntraced(function* (
    row: ProjectPolicyRow,
    names: readonly string[],
    excluding: string | undefined,
    settle: boolean,
  ) {
    const unreadable: UnreadableCopy[] = [];
    const listed = yield* Effect.result(refused(checkoutsOf(git, row.rootPath)));
    if (listed?._tag === 'Failure') {
      unreadable.push({ projectId: row.id, checkout: row.rootPath, branch: null, names: [...names], error: refusalBody(listed.failure) });
    }
    const standing = listed?._tag === 'Success' ? listed.success : [];
    const canonical = yield* canon(row.rootPath);
    const standingPlaces = [
      { checkout: row.rootPath, branch: null, canonical: true },
      ...standing.flatMap((worktree) =>
        worktree.path === canonical || worktree.branch === null
          ? []
          : [{ checkout: worktree.path, branch: worktree.branch, canonical: false }],
      ),
    ];
    const indexed: (IndexedCopy & { readonly mirror: string })[] = [];
    for (const place of standingPlaces) {
      const layout = yield* Effect.result(
        refused(
          resolveStorageLayout({ mode: row.storage, projectId: row.id, ...storageHomes(machineStore.path), worktree: place.checkout }),
        ),
      );
      if (layout._tag === 'Failure') {
        unreadable.push({
          projectId: row.id,
          checkout: place.checkout,
          branch: place.branch,
          names: [...names],
          error: refusalBody(layout.failure),
        });
        continue;
      }
      if (layout.success.treeRoot === excluding) continue;
      const held = copies.at(layout.success.treeRoot);
      const kicked = !settle || held === undefined || held.graph.projectId !== row.id ? null : yield* Effect.result(held.graph.fresh());
      if (kicked?._tag === 'Failure') {
        unreadable.push({
          projectId: row.id,
          checkout: place.checkout,
          branch: place.branch,
          names: [...names],
          error: refusalBody(kicked.failure),
        });
        continue;
      }
      indexed.push({ projectId: row.id, ...place, mirror: layout.success.mirrorPath });
    }
    return { copies: indexed, unreadable };
  });

  const letGo = Effect.fnUntraced(function* (projectId: number) {
    yield* dropAll(projectId);
    yield* machineStore.transaction(lettingGo, () => machineStore.db.delete(meta).where(eq(meta.key, blocksRetiredKey(projectId))));
  });

  const projectChanges = yield* ProjectChanges;
  const unregisterProject = projectChanges.removed.subscribe(({ projectId }) => releaseProject(projectId));
  const unchanged = projectChanges.changed.subscribe(Effect.sync(() => places.forgetAll()));
  const unpolicied = policy.subscribe(({ projectId }) => Effect.sync(() => places.forget(projectId)));

  const warmOne = Effect.fnUntraced(function* (projectId: number) {
    const opened = yield* Effect.exit(Effect.flatMap(reach({ projectId }, 'background', copies.use), (reached) => reached.view.fresh()));
    if (Exit.isFailure(opened)) {
      yield* Effect.logWarning('a graph copy another project reads could not be opened to build its index', {
        projectId,
        cause: opened.cause,
      });
    }
  });

  const warm = (projectIds: ReadonlySet<number>) =>
    Effect.sync(() => {
      for (const projectId of projectIds) {
        if (closed || warming.has(projectId)) continue;
        warming.add(projectId);
        warmFork(warmOne(projectId));
      }
    });

  const holdServed = Effect.fnUntraced(function* (place: CopyPlace): Effect.fn.Return<ServedGraph | null, never, Scope.Scope> {
    for (;;) {
      const copy = servingCopy(place);
      if (copy !== undefined && copies.current(copy)) {
        const held = yield* seized(copy, copy.graph);
        if (held !== null) return held;
        continue;
      }
      const pending = [...opening.values()].find((one) => one.projectId === place.projectId && one.checkout === place.checkout);
      if (pending === undefined) return null;
      yield* Deferred.await(pending.done);
    }
  });

  const remotes = yield* makeGraphRemotes({
    gates: gate,
    storePath: machineStore.path,
    fork: (effect) => void keepFork(effect),
    moved: (gitDir) => freshnessGate.remoteMoved(gitDir),
    exclusive: (projectId, effect) => copies.exclusive(projectId, Effect.uninterruptible(effect)),
    release: dropAll,
    open: (projectId) => Effect.flatMap(resolve({ projectId }), (served) => served.settled(true)),
    reopen: (projectId) => Effect.flatMap(within(projectId, null), (served) => served.settled(true)),
  });

  const served = ServedGraphs.of({
    resolve,
    hold,
    holdServed,
    checkout: Effect.fn('GraphPool.checkout')(function* (input) {
      const placed = yield* servingSwitch.servedBy(input);
      return placed.readOnly?.checkout ?? placed.checkout;
    }),
    held: copies.held,
    copies: { subscribe: copies.subscribe },
    whileClosed: (place, work) =>
      Effect.map(
        gate(entryGateKey(place.treeRoot)).withPermitsIfAvailable(1)(
          gate(mirrorGateKey(place.mirrorPath)).withPermitsIfAvailable(1)(
            Effect.suspend(() => (copies.at(place.treeRoot) !== undefined ? Effect.succeed(null) : work)),
          ),
        ),
        (held) => Option.getOrNull(Option.flatten(held)),
      ),
    titles: Effect.fn('GraphPool.titles')(function* (input) {
      if (closed) return yield* closedRefusal();
      const rows = yield* refused(policy.read(input.projectIds));
      const listed = yield* Effect.forEach(
        input.projectIds.flatMap((projectId) => {
          const row = rows.get(projectId);
          return row === undefined ? [] : [row];
        }),
        (row) => indexedCopies(row, input.names, input.excluding, input.settle ?? true),
        { concurrency: 'unbounded' },
      );
      const copies = listed.flatMap((one) => one.copies);
      const unreadable = listed.flatMap((one) => one.unreadable);
      const readings = yield* copyIndexReader.read(copies, input.names);
      const titles: IndexedTitle[] = [];
      const unindexed: IndexedCopy[] = [];
      for (const [at, copy] of copies.entries()) {
        const reading = readings[at];
        const indexed: IndexedCopy = { projectId: copy.projectId, checkout: copy.checkout, branch: copy.branch, canonical: copy.canonical };
        if (reading === undefined || reading.kind === 'unindexed') unindexed.push(indexed);
        else if (reading.kind === 'unreadable') {
          unreadable.push({
            projectId: copy.projectId,
            checkout: copy.checkout,
            branch: copy.branch,
            names: [...input.names],
            error: refusalBody(
              new GateRefusal('graph-pool', `the name index of ${copy.checkout} could not be read: ${reading.reason}`, [
                'open the copy once, so its index is rebuilt, then retry',
              ]),
            ),
          });
        } else for (const row of reading.rows) titles.push({ ...row, ...indexed });
      }
      return { titles, unreadable, unindexed };
    }),
    ...makeForeignBlocks({
      index: copyIndexReader,
      projects: yield* Projects,
      policy,
      storePath: machineStore.path,
      warm,
    }),
    releaseProject,
    birth: Effect.fnUntraced(
      function* (projectId) {
        const served = yield* within(projectId, steps.last);
        yield* served.settled();
      },
      (effect, projectId) =>
        copies.exclusive(
          projectId,
          Effect.onError(effect, () => Effect.orDie(letGo(projectId))),
        ),
    ),
    branches: servingSwitch.branches,
    dispose: Effect.fnUntraced(function* () {
      closed = true;
      yield* Scope.close(warmScope, Exit.void);
      yield* Scope.close(keepScope, Exit.void);
      places.close();
      unregisterProject();
      unchanged();
      unpolicied();
      for (const settled of [...opening.values()]) yield* Deferred.await(settled.done);
      copyIndexReader.close();
      const failures: unknown[] = [];
      for (const copy of copies.all()) {
        yield* closedTrees(freshnessGate, copy.treeRoot, copy.graph);
        yield* flushed(copy.treeRoot, copy.graph);
        const ended = yield* Effect.exit(copy.graph.dispose());
        if (Exit.isFailure(ended)) failures.push(Cause.squash(ended.cause));
        else if (copies.unpublish(copy)) copies.closed(copy);
      }
      if (failures.length > 0) {
        return yield* Effect.die(new AggregateError(failures, `GraphPool failed to dispose ${failures.length} served graph(s).`));
      }
      gates.clear();
    }),
    moveProjectStorage: Effect.fnUntraced(
      function* (input) {
        return yield* servingSwitch.move(input, {
          releaseProject: dropAll,
          resolveFresh: Effect.fnUntraced(function* (projectId: number) {
            const served = yield* within(projectId, null);
            yield* served.settled(true);
            yield* served.checkoutChanged;
          }),
          kept: Effect.fnUntraced(function* (projectId: number, names: readonly string[]) {
            const served = yield* within(projectId, null);
            yield* served.settled(true);
            const judged = Effect.gen(function* () {
              return yield* judgeKept((yield* GraphStore).db, yield* Tags, yield* BlockNames, projectId, names);
            });
            return yield* refused(Effect.provide(judged, served.context));
          }),
        });
      },
      (effect, input) => copies.exclusive(input.projectId, Effect.uninterruptible(effect)),
    ),
    release: Effect.fnUntraced(function* (place) {
      const copy = copies.of(place);
      if (copy !== undefined) yield* closing(copy, () => true);
    }),
  });

  const followBranch = yield* makeTwinning({ gate, copies }).pipe(Effect.provideService(ServingSwitch, servingSwitch));
  const graphChanges = yield* makeBranchChanges(served).pipe(Effect.provideService(ServingSwitch, servingSwitch));

  return {
    ...served,
    gate,
    freshnessGate,
    mergeFormat,
    recoveries,
    remotes: remotes.service,
    followBranch,
    graphChanges,
  };
});

export type GraphPool = Effect.Success<typeof makeGraphPool>;
