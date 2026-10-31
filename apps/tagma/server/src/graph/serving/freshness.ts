import { Cause, Clock, Context, Deferred, Effect, Exit, FiberSet, Option, Scope, type Semaphore } from 'effect';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { GateRefusal, refusalBody, type FloorRefusal, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { Act, BlockProjection, BlockReferences, SearchUncounted } from '../contract/service/acts.js';
import type { Tags } from '../contract/service/vocabulary.js';
import type { WriterRegister } from '../../platform/contract/service/writers.js';
import { GraphSteps } from '../contract/service/steps.js';
import type { BlockTreeUnreadable } from '../tree/layout.js';
import type { MirrorFailed, MirrorRefused } from '../tree/mirror.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { type StorageLayout } from '../storage/layout.js';
import { applyTree, readTree, type StoredBasis, type TreeChange, type TreeMark, type TreeReading } from '../tree/freshness.js';
import type { TreeRoots } from '../tree/layout.js';
import { STEALTH_PREFIX } from '../contract/wire/storage.js';
import { FileWatcher } from '../../platform/contract/service/watch.js';
import { rebuildMirror, repairMirror } from '../tree/mirror.js';
import { treeHeadStamp } from '../tree/stamp.js';
import { scanTree } from '../tree/scan.js';
import type { TreeLedger } from '../tree/ledger.js';
import { type ShadowGit } from '../tree/shadow.js';
import { readTopology, rememberTopology, syncTopology, type TopologyMemory, type TopologySync } from '../tree/topology.js';
import { watchingCheckout } from '../../workspace/watch/tree.js';
import type { TreeRescan, TreeShift, TreeWatch } from '../../platform/watch/tree.js';
import { Git } from '@runlith/git/Git';
import { WaitUnderHold } from '@runlith/held/failures';
import { CurrentCost, producerCost } from '@runlith/performance/CostLedger';
import { UnitWrites } from '../../platform/store/writes.js';
import { refused } from './refusal.js';
import {
  FreshnessGate,
  MirrorBuilder,
  VocabularyFormat,
  type FreshnessInit,
  type GraphContext,
  type TreeBatches,
  type SiblingPlace,
  type TopologyPlace,
} from '../contract/service/serving.js';
import { overRepository, overRepositoryAndTree, overTree } from './permits.js';
import { advanceTree } from './advance.js';
import type { CopyFailure } from '../contract/wire/answers.js';
import { Background } from '../../platform/contract/service/background.js';
import { Mirrors } from '../contract/service/mirrors.js';

const RETRY_FIRST_MS = 1_000;
const RETRY_CAP_MS = 300_000;

const REOPEN_MS = 2_000;

const REOPEN_CEILING_MS = 60_000;

const LOSSES: ReadonlySet<TreeRescan> = new Set(['lost', 'error', 'polling']);

const SLOTS: readonly TreeMark['slot'][] = [0, 1, 2];

type MirrorReadFailure =
  | BlockTreeUnreadable
  | MirrorRefused
  | MirrorFailed
  | StoreFailure
  | SearchUncounted
  | GateRefusal<FloorRefusal | 'duplicate-identity'>;

type Refreshing = {
  from: number;
  topologyTaken: boolean;
  readonly done: Deferred.Deferred<void, GateRefusal<OpenRefusal>>;
};

type EntryState = {
  readonly treeRoot: string;
  readonly checkout: string;
  readonly row: ProjectPolicyRow;
  readonly layout: StorageLayout;
  readonly roots: TreeRoots;
  readonly prefix: FreshnessInit['prefix'];
  readonly shadow: ShadowGit | null;
  readonly poolContext: GraphContext;
  readonly ledger: TreeLedger;
  readonly batches: TreeBatches | null;
  readonly stamp: ReturnType<typeof treeHeadStamp>;
  readonly fork: (effect: Effect.Effect<void>) => unknown;
  readonly watcher: FileWatcher['Service'] | null;
  watch: TreeWatch | null;
  healing: boolean;
  based: boolean;
  mark: TreeMark | null;
  fallback: TreeMark | null;
  lasting: boolean;
  named: Set<string> | null;
  seen: TreeReading | null;
  observed: number;
  applied: number;
  topologyStale: boolean;
  readonly topologyMemory: TopologyMemory;
  synced: TopologySync | null;
  running: Refreshing | null;
  again: boolean;
  failures: number;
  retryAt: number;
  failed: Cause.Cause<GateRefusal<OpenRefusal>> | null;
  failedSeen: number;
  retrying: boolean;
};

const notServed = (treeRoot: string) =>
  new GateRefusal('not-served', `no served graph stands on ${treeRoot}`, ['resolve the checkout first, then read it fresh']);

const watching = (state: EntryState): boolean => state.watch !== null && state.watch.watching();

const twinned = (state: EntryState): boolean => state.shadow !== null && state.layout.mode === 'stealth';

const inMirror = (state: EntryState, paths: readonly string[]): string[] => paths.map((path) => `${state.prefix}${path}`);

const changesInMirror = (state: EntryState, changes: readonly TreeChange[]): TreeChange[] =>
  changes.map((change) => ({ status: change.status, path: `${state.prefix}${change.path}` }));

const name = (state: EntryState, paths: readonly string[]): void => {
  if (state.named === null) return;
  for (const path of paths) state.named.add(path);
};

export const makeFreshnessGate = Effect.fnUntraced(function* ({
  gates,
  storePath,
  changed,
}: {
  readonly gates: (key: string) => Semaphore.Semaphore;
  readonly storePath: string;
  readonly changed: (projectId: number) => void;
}) {
  const git = yield* Git;
  const clock = yield* Clock.Clock;
  const builder = yield* MirrorBuilder;
  const steps = yield* GraphSteps;
  const background = yield* Background;
  const mirrors = yield* Mirrors;
  const entries = new Map<string, EntryState>();

  const siblings = Effect.fnUntraced(function* ({ shadow, layout }: SiblingPlace) {
    const copyFailures: CopyFailure[] = [];
    if (layout.mode !== 'stealth') return { blocked: undefined, copyFailures };
    for (const entry of entries.values()) {
      if (entry.layout.mode !== 'stealth' || entry.layout.gitDir !== layout.gitDir || entry.batches === null) continue;
      const own = entry.treeRoot === layout.treeRoot;
      const flushed = yield* Effect.result(own ? entry.batches.flush : overTree(gates, entry.treeRoot)(entry.batches.flush));
      if (flushed._tag === 'Success') continue;
      if (own) return yield* flushed.failure;
      copyFailures.push({
        copy: { projectId: entry.row.id, checkout: entry.checkout, tree: entry.treeRoot },
        error: refusalBody(flushed.failure),
      });
    }
    const blocked = copyFailures.length === 0 ? undefined : yield* refused(shadow.branchesAt(copyFailures.map((entry) => entry.copy.tree)));
    return { blocked, copyFailures };
  });

  const prepareTopology = (place: TopologyPlace): Effect.Effect<TopologySync | null, GateRefusal<'graph-pool'>> => {
    const { shadow, layout, checkout, row } = place;
    if (shadow === null || layout.mode !== 'stealth') return Effect.succeed(null);
    const levelled = entries.get(layout.treeRoot)?.prefix !== STEALTH_PREFIX;
    return overRepositoryAndTree(
      gates,
      layout,
    )(
      Effect.gen(function* () {
        const reading = yield* siblings({ layout, shadow });
        const synced = yield* refused(
          syncTopology(shadow, checkout, layout.treeRoot, steps, {
            blocked: reading.blocked,
            retired: mirrors.departed(row.id),
            treeHold: (tree) => overTree(gates, tree),
            level: levelled ? (twin) => builder.level({ row, checkout, shadow, twin, target: layout.treeRoot }) : undefined,
          }),
        );
        return { ...synced, copyFailures: reading.copyFailures.length === 0 ? undefined : reading.copyFailures };
      }),
    );
  };

  const replayTopology = Effect.fnUntraced(function* (state: EntryState) {
    const shadow = state.shadow;
    if (shadow === null || state.layout.mode !== 'stealth') return false;
    const reading = yield* refused(readTopology(shadow, state.checkout, state.layout.treeRoot, state.topologyMemory));
    if (!reading.due) {
      if (reading.branch !== null)
        state.synced = {
          branch: reading.branch,
          forkedFrom: null,
          merges: [],
          pruned: [],
          stranded: state.synced?.stranded ?? [],
          checkouts: state.synced?.checkouts ?? [],
          copyFailures: state.synced?.copyFailures,
        };
      return false;
    }
    const synced = yield* prepareTopology(state);
    state.synced = synced;
    if (synced !== null) rememberTopology(state.topologyMemory, reading, synced);
    return synced !== null;
  });

  const loadBasis = Effect.fnUntraced(function* (state: EntryState) {
    state.based = true;
    const stored = yield* refused(state.stamp.readBasis.pipe(Effect.provide(state.poolContext)));
    state.mark = stored?.mark ?? null;
    state.fallback = stored?.fallback ?? null;
    return stored;
  });

  const changedSince = (state: EntryState, mark: TreeMark | null) =>
    state.watcher === null || mark === null
      ? Effect.succeed(null)
      : state.watcher
          .changedSince(state.layout.treeRoot, mark.position, [])
          .pipe(Effect.catchTag('WatchRefused', () => Effect.succeed(null)));

  const coldScope = Effect.fnUntraced(function* (state: EntryState, stored: StoredBasis, named: ReadonlySet<string> | null) {
    const changed = (yield* changedSince(state, stored.mark)) ?? (yield* changedSince(state, stored.fallback));
    yield* Effect.annotateCurrentSpan({ cold: changed === null ? 'unknown' : changed.length });
    if (changed === null) return null;
    const paths = new Set([...changed.map((change) => change.path), ...stored.dirty.map((change) => change.path), ...(named ?? [])]);
    return { since: stored, paths, staged: true };
  });

  const filedMark = (state: EntryState): TreeMark | null => (state.mark?.filed === true ? state.mark : state.fallback);

  const marked = Effect.fnUntraced(function* (state: EntryState): Effect.fn.Return<TreeMark | null> {
    const watcher = state.watcher;
    if (watcher === null) return null;
    const filed = watcher.marking === 'refresh' || state.lasting;
    const slot = SLOTS.find((one) => one !== state.mark?.slot && one !== state.fallback?.slot) ?? 0;
    const position = yield* watcher
      .mark(state.layout.treeRoot, `${state.layout.mirrorPath}${state.prefix === '' ? '' : '.stealth'}.watch-${slot}`, [], state.lasting)
      .pipe(Effect.catchTag('WatchRefused', () => Effect.succeed(null)));
    return position === null ? null : { position, slot, filed };
  });

  const refresh = Effect.fn('FreshnessGate.refresh', { root: true })(
    function* (state: EntryState) {
      const { layout, poolContext, ledger, row, stamp } = state;
      const stored = state.based ? null : yield* loadBasis(state);
      const mark = yield* marked(state);
      const named = state.named;
      state.named = new Set();
      const scope =
        stored !== null
          ? yield* coldScope(state, stored, named)
          : named === null || state.seen === null
            ? null
            : { since: state.seen, paths: named, staged: false };
      yield* Effect.annotateCurrentSpan({
        project: row.id,
        observed: state.observed,
        applied: state.applied,
        topology: state.topologyStale,
      });
      if (state.running !== null) state.running.topologyTaken = true;
      let replayed = false;
      if (state.topologyStale) {
        state.topologyStale = false;
        replayed = yield* replayTopology(state).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              state.topologyStale = true;
            }),
          ),
        );
      }
      yield* refused(builder.syncRegistry(poolContext));
      const outcome = yield* overRepository(
        gates,
        layout,
      )(
        Effect.gen(function* () {
          const format = Context.get(poolContext, VocabularyFormat);
          if (format !== null) yield* format.read;
          const reading = yield* refused(readTree(git, layout.treeRoot, stamp.readStamp, scope).pipe(Effect.provide(poolContext)));
          state.seen = reading;
          const applied = yield* overTree(
            gates,
            layout.treeRoot,
          )(
            Effect.gen(function* () {
              const absorbed = yield* refused(
                applyTree<MirrorReadFailure, GraphStore | Act | BlockProjection | BlockReferences | Tags | WriterRegister>(reading, {
                  writeStamp: stamp.writeStamp,
                  unreflected: (changed) => ledger.unreflected(changesInMirror(state, changed)),
                  rebuild: Effect.flatMap(scanTree(state.roots.root, state.roots.stealth), (scan) => rebuildMirror(scan, row.id)),
                  repair: (changed) => repairMirror(state.roots, changed, row.id),
                }).pipe(Effect.provide(poolContext)),
              );
              if (format === null || state.prefix !== '') return absorbed;
              const stepped = yield* refused(
                advanceTree({
                  project: row,
                  treeRoot: layout.treeRoot,
                  stealth: state.roots.stealth,
                  checkout: state.checkout,
                  shadow: state.shadow,
                  git,
                  format,
                  steps,
                  fromTree: true,
                }).pipe(Effect.provide(poolContext), Effect.provideService(Background, background)),
              );
              return stepped ? ('rebuilt' as const) : absorbed;
            }),
          );
          if (state.batches !== null) yield* state.batches.carry(reading.dirty.map((change) => change.path));
          const kept = mark ?? state.mark;
          const fallback = mark === null ? state.fallback : mark.filed ? null : filedMark(state);
          yield* refused(
            stamp
              .writeBasis({ head: reading.head, dirty: reading.dirty, rules: reading.rules, mark: kept, fallback })
              .pipe(Effect.provide(poolContext)),
          );
          state.mark = kept;
          state.fallback = fallback;
          if (mark?.filed === true) state.lasting = false;
          return applied;
        }),
      );
      yield* Effect.annotateCurrentSpan({ outcome });
      if (outcome !== 'fresh' || replayed) changed(row.id);
      if (outcome === 'fresh') return;
      yield* builder.forgetRegistry(poolContext);
      yield* refused(builder.syncRegistry(poolContext));
    },
    (effect, state) => Context.get(state.poolContext, GraphUnits).markWrite(effect),
  );

  const retryLater = (state: EntryState): void => {
    if (state.retrying) return;
    state.retrying = true;
    state.fork(
      Effect.flatMap(clock.currentTimeMillis, (now) => Effect.sleep(Math.max(0, state.retryAt - now))).pipe(
        Effect.andThen(
          Effect.sync(() => {
            state.retrying = false;
            if (entries.get(state.treeRoot) === state && state.running === null) start(state);
          }),
        ),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            state.retrying = false;
          }),
        ),
      ),
    );
  };

  const start = (state: EntryState): Refreshing => {
    const refreshing: Refreshing = {
      from: state.observed,
      topologyTaken: false,
      done: Deferred.makeUnsafe<void, GateRefusal<OpenRefusal>>(),
    };
    state.running = refreshing;
    state.again = false;
    state.fork(
      producerCost('FreshnessGate.refresh', refresh(state)).pipe(
        Effect.provideService(CurrentCost, null),
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            state.running = null;
            if (Exit.isFailure(exit)) state.named = null;
            if (Exit.isSuccess(exit)) {
              state.applied = Math.max(state.applied, refreshing.from);
              state.failures = 0;
              state.failed = null;
            } else if (!Cause.hasInterruptsOnly(exit.cause)) {
              state.failures += 1;
              state.failed = exit.cause;
              state.failedSeen = refreshing.from;
              const waitMs = Math.min(RETRY_FIRST_MS * 2 ** (state.failures - 1), RETRY_CAP_MS);
              state.retryAt = (yield* clock.currentTimeMillis) + waitMs;
              yield* Effect.logWarning('a tree refresh failed: reads answer the last committed snapshot, acts refuse, and it runs again', {
                tree: state.treeRoot,
                failures: state.failures,
                retryInMs: waitMs,
                reason: Cause.squash(exit.cause),
              });
            }
            Deferred.doneUnsafe(refreshing.done, exit);
            if (entries.get(state.treeRoot) !== state || Exit.hasInterrupts(exit)) return;
            if (Exit.isFailure(exit)) {
              if (state.again || state.applied < state.observed) retryLater(state);
              return;
            }
            if (state.again) start(state);
          }),
        ),
        Effect.exit,
        Effect.asVoid,
      ),
    );
    return refreshing;
  };

  const kick = (state: EntryState, now: boolean): Refreshing | null => {
    if (state.running !== null) {
      if (state.running.from < state.observed) state.again = true;
      return state.running;
    }
    if (!now && state.failures > 0 && clock.currentTimeMillisUnsafe() < state.retryAt) {
      retryLater(state);
      return null;
    }
    return start(state);
  };

  const observe = (state: EntryState): void => {
    state.observed += 1;
    kick(state, false);
  };

  const refsMoved = (state: EntryState): void => {
    state.topologyStale = true;
    const running = state.running;
    if (running === null || running.topologyTaken || running.from !== state.observed) return observe(state);
    state.observed += 1;
    running.from = state.observed;
  };

  const heard = (state: EntryState, shift: TreeShift): void => {
    if ('rescan' in shift && shift.rescan === 'rename' && twinned(state) && (shift.paths ?? []).length > 0) {
      if (shift.movement === 'index') return;
      if (shift.movement === 'head' || shift.movement === 'refs') return refsMoved(state);
    }
    if ('rescan' in shift) {
      if (shift.movement === 'tree' && shift.rescan === 'rename' && shift.paths !== undefined && shift.paths.length > 0) {
        name(state, shift.paths);
        if (state.ledger.echoes(inMirror(state, shift.paths))) return;
      } else state.named = null;
      state.topologyStale = twinned(state);
      observe(state);
      if (LOSSES.has(shift.rescan) && entries.get(state.treeRoot) === state) heal(state, REOPEN_MS);
      return;
    }
    if (shift.movement === 'tree') {
      name(state, shift.paths);
      if (state.ledger.echoes(inMirror(state, shift.paths))) return;
      observe(state);
    } else if (shift.movement === 'head' && twinned(state)) {
      refsMoved(state);
    } else if ((shift.movement === 'ignore' || shift.movement === 'config') && !twinned(state)) {
      observe(state);
    }
  };

  const openWatch = Effect.fnUntraced(function* (state: EntryState) {
    state.watch?.close();
    state.watch = null;
    const watch = yield* watchingCheckout(
      git,
      { tree: state.layout.treeRoot, gitFrom: state.layout.mode === 'stealth' ? state.checkout : null },
      (shift) => heard(state, shift),
    );
    if (entries.get(state.treeRoot) !== state) return watch.close();
    state.watch = watch;
    if (!watch.watching()) heal(state, REOPEN_MS);
  });

  const heal = (state: EntryState, first: number): void => {
    if (state.healing) return;
    state.healing = true;
    state.fork(
      Effect.gen(function* () {
        let wait = first;
        for (;;) {
          yield* Effect.sleep(wait);
          if (entries.get(state.treeRoot) !== state || watching(state)) return;
          yield* openWatch(state);
          if (watching(state)) return;
          wait = Math.min(wait * 2, REOPEN_CEILING_MS);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            state.healing = false;
          }),
        ),
      ),
    );
  };

  const settled = Effect.fn('FreshnessGate.settled')(function* (treeRoot: string, force = false, lasting = false) {
    const state = entries.get(treeRoot);
    if (state === undefined) return yield* notServed(treeRoot);
    const held = [...(yield* UnitWrites).keys()].filter((store) => store.path === storePath || store.path === state.layout.mirrorPath);
    if (held.length > 0) {
      return yield* Effect.die(
        new WaitUnderHold({ waitingOn: `tree-refresh:${treeRoot}`, holding: held.map((store) => `writer:${store.path}`) }),
      );
    }
    if (force || !watching(state)) state.named = null;
    if (lasting) state.lasting = true;
    if (force || lasting || !watching(state)) state.observed += 1;
    const wanted = state.observed;
    for (;;) {
      if (entries.get(treeRoot) !== state) return yield* notServed(treeRoot);
      if (state.applied >= wanted && (yield* builder.registrySynced(state.poolContext))) return;
      if (
        !force &&
        !lasting &&
        state.running === null &&
        state.failed !== null &&
        watching(state) &&
        state.observed <= state.failedSeen &&
        (yield* clock.currentTimeMillis) < state.retryAt
      ) {
        return yield* Effect.failCause(state.failed);
      }
      const refreshing = kick(state, true);
      if (refreshing === null) continue;
      const ended = yield* Effect.exit(Deferred.await(refreshing.done));
      if (Exit.isSuccess(ended) || refreshing.from < wanted) continue;
      if (Cause.hasInterruptsOnly(ended.cause)) return yield* notServed(treeRoot);
      return yield* Effect.failCause(ended.cause);
    }
  });

  return FreshnessGate.of({
    register: Effect.fnUntraced(function* (treeRoot, init) {
      const fork = yield* FiberSet.makeRuntime<never, void, never>().pipe(Effect.provideService(Scope.Scope, init.scope));
      const state: EntryState = {
        treeRoot,
        checkout: init.checkout,
        row: init.row,
        layout: init.layout,
        roots: init.roots,
        prefix: init.prefix,
        shadow: init.shadow,
        poolContext: init.poolContext,
        ledger: init.ledger,
        batches: init.batches,
        stamp: treeHeadStamp(init.prefix !== ''),
        fork,
        watcher: Option.getOrNull(yield* Effect.serviceOption(FileWatcher)),
        watch: null,
        healing: false,
        based: false,
        mark: null,
        fallback: null,
        lasting: false,
        named: null,
        seen: null,
        observed: 1,
        applied: 0,
        topologyStale: false,
        topologyMemory: {
          absorbed: new Map(),
          remote: new Map(init.topology?.remote === undefined ? [] : [[init.topology.remote.branch, init.topology.remote.tip]]),
          stranded: new Set(init.topology?.stranded.map((one) => one.branch)),
          checkouts: init.topology?.checkouts ?? null,
        },
        synced: null,
        running: null,
        again: false,
        failures: 0,
        retryAt: 0,
        failed: null,
        failedSeen: 0,
        retrying: false,
      };
      const unregister = () => {
        if (entries.get(treeRoot) !== state) return;
        entries.delete(treeRoot);
        state.watch?.close();
        state.watch = null;
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => entries.set(treeRoot, state)),
        () => Effect.sync(unregister),
      ).pipe(Effect.provideService(Scope.Scope, init.scope));
      yield* openWatch(state);
      return { unregister };
    }),
    fresh: (treeRoot) =>
      Effect.suspend(() => {
        const state = entries.get(treeRoot);
        if (state === undefined) return Effect.fail(notServed(treeRoot));
        return Effect.flatMap(builder.registrySynced(state.poolContext), (synced) =>
          Effect.sync(() => {
            if (synced && watching(state) && state.applied === state.observed) return;
            if (!watching(state)) state.named = null;
            if (!watching(state) || !synced) state.observed += 1;
            kick(state, false);
          }),
        );
      }),
    settled: (treeRoot, force) => settled(treeRoot, force),
    close: Effect.fnUntraced(function* (treeRoot) {
      const state = entries.get(treeRoot);
      if (state === undefined || state.watcher?.marking !== 'close') return;
      const ended = yield* Effect.exit(settled(treeRoot, false, true));
      if (Exit.isFailure(ended))
        yield* Effect.logWarning('the last refresh of a closing tree failed: its stored basis keeps the mark it had', {
          tree: treeRoot,
          reason: Cause.squash(ended.cause),
        });
    }),
    beforeAct: (treeRoot) => Effect.suspend(() => (entries.has(treeRoot) ? settled(treeRoot) : Effect.void)),
    topology: Effect.fnUntraced(function* (treeRoot) {
      const state = entries.get(treeRoot);
      if (state === undefined || !twinned(state)) {
        yield* settled(treeRoot);
        return null;
      }
      state.topologyStale = true;
      yield* settled(treeRoot, true);
      return state.synced;
    }),
    copyFailures: (treeRoot) =>
      Effect.suspend(() => {
        const state = entries.get(treeRoot);
        return state === undefined ? Effect.fail(notServed(treeRoot)) : Effect.succeed(state.synced?.copyFailures ?? []);
      }),
    prepareTopology,
    siblings,
    remoteMoved: (gitDir) =>
      Effect.suspend(() => {
        const moved = [...entries.values()].filter((state) => state.layout.mode === 'stealth' && state.layout.gitDir === gitDir);
        for (const state of moved) refsMoved(state);
        return Effect.forEach(moved, (state) => settled(state.treeRoot), { discard: true });
      }),
  });
});
