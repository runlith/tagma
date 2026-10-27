import { Cause, Effect, Exit, Fiber, Queue, Scope, Stream } from 'effect';
import type { CheckoutState } from '../../workspace/contract/wire/checkout.js';
import type { ProjectRoot, ProjectRootFailure } from '../../workspace/contract/wire/coverage.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { RootResolutionFailure } from '../../workspace/contract/wire/roots.js';
import type { CheckoutsMoved } from '../../workspace/contract/service/checkouts.js';
import type { PendingMerge } from '../contract/wire/mergeTypes.js';
import type { WorktreeUnavailable } from '../contract/wire/failures.js';
import type { WorktreeElsewhere, WorktreeFeedEvent, WorktreeRow } from '../contract/wire/rows.js';
import type { WorktreeRecord } from '../contract/service/worktrees.js';
import type { MergeVerdict } from '../contract/service/mergeChecks.js';
import type { Distance, Entry, Sight, StateSnapshot, StateQuestion } from './rowShapes.js';
import { UNTAKEN } from './rowShapes.js';
import type { ThreadPlacing } from '../contract/service/finishingGate.js';
import { placeOf, strayOf } from './placings.js';
import type { MetadataSnapshot, TreeMetadata } from './metadata.js';
import { factOf } from './readings.js';
import { summarize } from './rowEntries.js';

export type WorktreeFeedFailure = ProjectRootFailure | WorktreeUnavailable;
export type WorktreeMembership = {
  readonly canonical: ProjectRoot | undefined;
  readonly records: readonly WorktreeRecord[];
  readonly external: readonly ProjectRoot[];
  readonly pending: ReadonlyMap<string, PendingMerge>;
  readonly metadata: MetadataSnapshot;
  readonly states: ReadonlyMap<RootId, StateSnapshot>;
  readonly verdicts: ReadonlyMap<string, MergeVerdict>;
};

export type FeedReads = {
  readonly membership: (projectId: number) => Effect.Effect<WorktreeMembership, WorktreeFeedFailure>;
  readonly pending: (projectId: number) => Effect.Effect<ReadonlyMap<string, PendingMerge>, WorktreeUnavailable>;
  readonly placings: (projectId: number, threadIds?: readonly string[]) => Effect.Effect<readonly ThreadPlacing[], WorktreeUnavailable>;
  readonly follow: (rootId: RootId) => Effect.Effect<Stream.Stream<CheckoutState>, RootResolutionFailure, Scope.Scope>;
  readonly state: (question: StateQuestion) => Effect.Effect<StateSnapshot, WorktreeUnavailable>;
  readonly verdict: (path: string, tip: string, head: string, start: boolean) => Effect.Effect<MergeVerdict, WorktreeUnavailable>;
  readonly checked: (listener: (path: string) => void) => () => void;
  readonly topology: (path: string) => Stream.Stream<CheckoutsMoved>;
};

export type Frames = Queue.Queue<WorktreeFeedEvent, WorktreeFeedFailure | Cause.Done>;

type MainTree = { readonly kind: 'main'; root: ProjectRoot; sight: Sight; headTime: number | null };
type ExternalTree = { readonly kind: 'external'; root: ProjectRoot; sight: Sight };
type RecordedTree = {
  readonly kind: 'tagma';
  record: WorktreeRecord;
  pending: PendingMerge | null;
  sight: Sight;
  tip: string | null;
  tipTime: number | null;
  distance: Distance | null;
};
export type Tree = MainTree | ExternalTree | RecordedTree;

export type FeedState = {
  readonly trees: Map<string, Tree>;
  readonly entries: Map<string, Entry>;
  readonly standing: Map<string, Map<string, ThreadPlacing>>;
  readonly strays: Map<string, WorktreeElsewhere>;
  readonly shown: Map<string, WorktreeRow>;
  readonly rowsMoved: Set<string>;
  order: readonly string[];
  sentOrder: readonly string[] | null;
  elsewhere: readonly WorktreeElsewhere[];
  sentElsewhere: string;
  strayed: boolean;
};

export type FeedMembership = {
  readonly state: FeedState;
  readonly unseen: (rootId: string) => boolean;
  readonly treesMoved: (poked: ReadonlySet<string>, seen: Set<string>, scope: Scope.Scope) => Effect.Effect<void, WorktreeFeedFailure>;
  readonly resighted: (
    rootIds: readonly string[],
    seen: Set<string>,
    scope: Scope.Scope,
    mode?: StateQuestion['mode'],
  ) => Effect.Effect<void, WorktreeUnavailable>;
  readonly reconcile: (next: WorktreeMembership) => Effect.Effect<ReadonlySet<string>>;
  readonly checked: (paths: ReadonlySet<string>) => Effect.Effect<void>;
  readonly checkBusy: (scope: Scope.Scope) => Effect.Effect<void, WorktreeUnavailable>;
  readonly placeAll: (read: readonly ThreadPlacing[]) => void;
  readonly placeOne: (threadId: string, next: ThreadPlacing | undefined) => void;
};

export const rootOf = (tree: Tree): RootId => (tree.kind === 'tagma' ? tree.record.rootId : tree.root.rootId);
export const pathOf = (tree: Tree): string => (tree.kind === 'tagma' ? tree.record.path : tree.root.path);
const ABSENT: TreeMetadata = { head: null, ref: null, headTime: null, present: false };

export const makeFeedMembership = (input: {
  readonly reads: FeedReads;
  readonly poke: (rootId: string, metadata?: boolean) => void;
  readonly changed: () => void;
  readonly leaving: (rootId: string) => boolean;
  readonly visible: () => ReadonlySet<string>;
  readonly held: () => ReadonlySet<string>;
}): FeedMembership => {
  const { reads, poke, changed, leaving, visible, held } = input;
  const state: FeedState = {
    trees: new Map(),
    entries: new Map(),
    standing: new Map(),
    strays: new Map(),
    shown: new Map(),
    rowsMoved: new Set(),
    order: [],
    sentOrder: null,
    elsewhere: [],
    sentElsewhere: '',
    strayed: true,
  };
  const { trees, standing, strays, rowsMoved } = state;
  const followers = new Map<string, Scope.Closeable>();
  const flights = new Map<string, { fiber: Fiber.Fiber<void> | null; again: boolean; echo: string | null }>();
  const placings = new Map<string, ThreadPlacing>();
  let canonical: ProjectRoot | undefined;
  const busy = (rootId: string): boolean =>
    [...(standing.get(rootId)?.values() ?? [])].some((one) => one.state === 'working' || one.state === 'waiting');
  const working = (tree: Tree): boolean => tree.kind === 'main' || busy(rootOf(tree)) || held().has(pathOf(tree));
  const wanted = (tree: Tree): boolean => !leaving(rootOf(tree)) && (working(tree) || visible().has(rootOf(tree)));

  const release = (rootId: string): Effect.Effect<void> => {
    const own = followers.get(rootId);
    followers.delete(rootId);
    return own === undefined ? Effect.void : Scope.close(own, Exit.void);
  };
  const follow = Effect.fnUntraced(function* (tree: Tree, scope: Scope.Scope) {
    const rootId = rootOf(tree);
    if (!working(tree) || !tree.sight.present) return yield* release(rootId);
    if (followers.has(rootId)) return;
    const own = yield* Scope.fork(scope);
    const followed = yield* Effect.result(Scope.provide(reads.follow(rootId), own));
    if (followed._tag === 'Failure') {
      yield* Scope.close(own, Exit.void);
      return yield* Effect.logWarning('a working checkout could not be observed', { rootId, reason: followed.failure.message });
    }
    followers.set(rootId, own);
    yield* Effect.forkIn(
      Stream.runForEach(followed.success, (read) =>
        Effect.sync(() => {
          const sight = trees.get(rootId)?.sight;
          const metadata = sight?.metadata;
          const moved = read.stale || metadata?.head !== read.head || metadata?.ref !== (read.ref?.replace(/^refs\/heads\//u, '') ?? null);
          const shown = JSON.stringify(summarize(read));
          const flying = flights.get(rootId);
          if (!moved && flying !== undefined) {
            flying.echo = shown;
            return;
          }
          if (!moved && sight?.read != null && JSON.stringify(sight.read) === shown) return;
          poke(rootId, moved);
        }),
      ),
      own,
    );
  });
  const measure = Effect.fnUntraced(function* (tree: Tree, start: boolean) {
    if (tree.kind !== 'tagma' || !tree.sight.present || !wanted(tree)) return;
    const head = tree.sight.metadata?.head ?? null;
    if (head === null || tree.tip === null || tree.record.baseBranch === null) return;
    const rootId = tree.record.rootId;
    yield* reads.verdict(tree.record.path, tree.tip, head, start).pipe(
      Effect.map((verdict) => {
        const distance: Distance = {
          ahead: tree.distance?.ahead ?? null,
          behind: tree.distance?.behind ?? null,
          check: verdict.check,
          held: verdict.held,
          fact: verdict.fact,
        };
        if (JSON.stringify(distance) !== JSON.stringify(tree.distance)) rowsMoved.add(rootId);
        tree.distance = distance;
      }),
      Effect.catchTag('WorktreeUnavailable', (failure) =>
        Effect.logWarning('a worktree merge verdict could not be read', { rootId, reason: failure.message }),
      ),
    );
  });
  const resighted = Effect.fnUntraced(function* (
    rootIds: readonly string[],
    seen: Set<string>,
    scope: Scope.Scope,
    mode: StateQuestion['mode'] = 'page',
  ) {
    const selected = rootIds.flatMap((rootId) => {
      const tree = trees.get(rootId);
      return tree === undefined ? [] : [tree];
    });
    for (const tree of selected) {
      yield* follow(tree, scope);
      if (wanted(tree)) continue;
      const flying = flights.get(rootOf(tree));
      if (flying?.fiber !== null && flying?.fiber !== undefined) yield* Fiber.interrupt(flying.fiber);
    }
    const shown = visible();
    const due = selected.filter(wanted).sort((a, b) => Number(shown.has(rootOf(b))) - Number(shown.has(rootOf(a))));
    for (const tree of due) {
      const rootId = rootOf(tree);
      seen.add(rootId);
      if (!tree.sight.present) continue;
      const flying = flights.get(rootId);
      if (flying !== undefined) {
        if (mode !== 'page') flying.again = true;
        continue;
      }
      const job: { fiber: Fiber.Fiber<void> | null; again: boolean; echo: string | null } = { fiber: null, again: false, echo: null };
      flights.set(rootId, job);
      const metadata = tree.sight.metadata ?? ABSENT;
      const tip = tree.kind === 'tagma' ? tree.tip : null;
      const tipTime = tree.kind === 'tagma' ? tree.tipTime : null;
      const work = Effect.gen(function* () {
        const read = yield* reads.state({
          rootId,
          path: pathOf(tree),
          metadata,
          tip,
          tipTime,
          mode,
          queued: () => {
            const current = trees.get(rootId);
            if (current === undefined) return;
            current.sight = { ...current.sight, fact: { ...(current.sight.fact ?? UNTAKEN), state: 'queued' } };
            rowsMoved.add(rootId);
            changed();
          },
        });
        const current = trees.get(rootId);
        if (current === undefined) return;
        const currentTip = current.kind === 'tagma' ? current.tip : null;
        current.sight = {
          ...current.sight,
          seen: true,
          read: read.read,
          fact: factOf(read, current.sight.metadata ?? metadata, currentTip),
        };
        if (current.kind === 'tagma')
          current.distance = {
            ...current.distance,
            ahead: read.ahead,
            behind: read.behind,
            check: current.distance?.check ?? 'unknown',
            held: current.distance?.held ?? false,
          };
        rowsMoved.add(rootId);
        yield* measure(current, true);
      }).pipe(
        Effect.catchTag('WorktreeUnavailable', (failure) =>
          Effect.gen(function* () {
            const current = trees.get(rootId);
            if (current !== undefined) {
              current.sight = { ...current.sight, seen: true, read: null, fact: undefined };
              rowsMoved.add(rootId);
            }
            yield* Effect.logWarning('a worktree state could not be read', { rootId, reason: failure.message });
          }),
        ),
        Effect.onExit(() =>
          Effect.sync(() => {
            if (flights.get(rootId) === job) flights.delete(rootId);
            changed();
            const shown = trees.get(rootId)?.sight.read;
            if (job.again && trees.has(rootId)) poke(rootId, true);
            else if (job.echo !== null && shown !== undefined && JSON.stringify(shown) !== job.echo) poke(rootId, true);
          }),
        ),
      );
      job.fiber = yield* Effect.forkIn(work, scope);
    }
  });

  const stand = (placing: ThreadPlacing): void => {
    const rootId = placeOf(placing, canonical?.rootId);
    if (rootId === undefined) return;
    const there = standing.get(rootId) ?? new Map<string, ThreadPlacing>();
    there.set(placing.threadId, placing);
    standing.set(rootId, there);
    rowsMoved.add(rootId);
  };
  const strayOne = (threadId: string, placing: ThreadPlacing | undefined): void => {
    const stray = placing === undefined ? null : strayOf(placing, (rootId) => trees.has(rootId));
    if (stray === null) strays.delete(threadId);
    else strays.set(threadId, stray);
    state.strayed = true;
  };
  const placeOne = (threadId: string, next: ThreadPlacing | undefined): void => {
    const before = placings.get(threadId);
    if (before !== undefined) {
      const rootId = placeOf(before, canonical?.rootId);
      if (rootId !== undefined) {
        standing.get(rootId)?.delete(threadId);
        rowsMoved.add(rootId);
      }
    }
    if (next === undefined) placings.delete(threadId);
    else {
      placings.set(threadId, next);
      stand(next);
    }
    strayOne(threadId, next);
  };
  const placeAll = (read: readonly ThreadPlacing[]): void => {
    for (const rootId of standing.keys()) rowsMoved.add(rootId);
    placings.clear();
    standing.clear();
    strays.clear();
    for (const placing of read) {
      placings.set(placing.threadId, placing);
      stand(placing);
      strayOne(placing.threadId, placing);
    }
    state.strayed = true;
  };
  const reconcile = Effect.fnUntraced(function* (next: WorktreeMembership) {
    const wanted = new Map<string, Tree>();
    canonical = next.canonical;
    const sight = (rootId: RootId, path: string, tip: string | null): Sight => {
      const metadata = next.metadata.trees.get(path) ?? (path === canonical?.path ? { ...ABSENT, present: true } : ABSENT);
      const saved = next.states.get(rootId);
      return {
        seen: saved !== undefined,
        present: metadata.present,
        gone: !metadata.present,
        read: saved?.read ?? null,
        metadata,
        fact: saved === undefined ? UNTAKEN : factOf(saved, metadata, tip),
      };
    };
    if (canonical !== undefined) {
      const seen = sight(canonical.rootId, canonical.path, null);
      wanted.set(canonical.rootId, { kind: 'main', root: canonical, sight: seen, headTime: seen.metadata?.headTime ?? null });
    }
    for (const root of next.external) wanted.set(root.rootId, { kind: 'external', root, sight: sight(root.rootId, root.path, null) });
    for (const record of next.records) {
      const base = record.baseBranch === null ? null : next.metadata.refs.get(`refs/heads/${record.baseBranch}`);
      const tip = record.baseBranch === null ? record.baseCommit : (base?.head ?? null);
      const saved = next.states.get(record.rootId);
      const verdict = next.verdicts.get(record.path);
      const metadata = next.metadata.trees.get(record.path) ?? ABSENT;
      const fact =
        verdict === undefined
          ? UNTAKEN
          : {
              ...verdict.fact,
              state:
                verdict.fact.state === 'current' && verdict.fact.head === metadata.head && verdict.fact.base === tip
                  ? ('current' as const)
                  : ('previous' as const),
            };
      wanted.set(record.rootId, {
        kind: 'tagma',
        record,
        pending: next.pending.get(record.rootId) ?? null,
        sight: sight(record.rootId, record.path, tip),
        tip,
        tipTime: base?.time ?? null,
        distance: {
          ahead: saved?.ahead ?? null,
          behind: saved?.behind ?? null,
          check: verdict?.check ?? 'unknown',
          held: verdict?.held ?? false,
          fact,
        },
      });
    }
    const built = new Set<string>();
    for (const rootId of trees.keys())
      if (!wanted.has(rootId)) {
        trees.delete(rootId);
        rowsMoved.add(rootId);
        yield* release(rootId);
        const flight = flights.get(rootId);
        if (flight !== undefined) {
          flight.again = false;
          if (flight.fiber !== null) yield* Fiber.interrupt(flight.fiber);
        }
      }
    for (const [rootId, nextTree] of wanted) {
      const before = trees.get(rootId);
      if (before === undefined || JSON.stringify(before) !== JSON.stringify(nextTree)) {
        rowsMoved.add(rootId);
        built.add(rootId);
      }
      trees.set(rootId, nextTree);
    }
    placeAll([...placings.values()]);
    return built;
  });
  return {
    state,
    unseen: (rootId) => trees.get(rootId)?.sight.seen === false,
    reconcile,
    resighted,
    treesMoved: Effect.fnUntraced(function* (poked, seen, scope) {
      yield* resighted([...poked], seen, scope, 'watched');
      yield* resighted(
        [...trees.keys()].filter((rootId) => !seen.has(rootId)),
        seen,
        scope,
        'page',
      );
    }),
    checked: (paths) =>
      Effect.suspend(() =>
        Effect.forEach(
          [...trees.values()].filter((tree) => tree.kind === 'tagma' && paths.has(tree.record.path)),
          (tree) => measure(tree, false),
          { concurrency: 3, discard: true },
        ),
      ),
    checkBusy: (scope) => resighted([...trees.keys()], new Set(), scope),
    placeAll,
    placeOne,
  };
};
