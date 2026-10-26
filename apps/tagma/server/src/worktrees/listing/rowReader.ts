import { Effect, Option, Stream } from 'effect';
import { page, pageRows, pastKey, readCursor, type PageQuestion } from '@runlith/paging';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { declaredRefusal } from '../../platform/contract/service/routed.js';
import { type GateRefusal, cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { Coverage } from '../../workspace/contract/service/roots.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import type { PendingMerge } from '../contract/wire/mergeTypes.js';
import { WorktreeUnavailable } from '../contract/wire/failures.js';
import type { WorktreeListAnswer, WorktreeRow, WorktreeWindow } from '../contract/wire/rows.js';
import { WORKTREES } from '../contract/wire/pages.js';
import { WorktreeRecords } from '../contract/service/worktrees.js';
import {
  WorktreeRows,
  WorktreeHeld,
  WORKTREE_ROW_REFUSALS,
  WORKTREE_ROWS_REFUSALS,
  type WorktreeRowsRefusal,
  type ProjectMoved,
} from '../contract/service/listing.js';
import { WorktreeThreads, type ThreadPlacing } from '../contract/service/finishingGate.js';
import type { WorktreeRecord } from '../contract/service/worktrees.js';
import type { ActProgress } from '../contract/service/progress.js';
import type { MergeChecks, MergeVerdict } from '../contract/service/mergeChecks.js';
import { worktreeRefusal } from '../contract/service/refusals.js';
import { makeFeedMembership, type FeedReads, type Tree, type WorktreeFeedFailure, type WorktreeMembership } from './membership.js';
import { makeWindows } from './windows.js';
import { makeMetadata } from './metadata.js';
import { factOf, makeReadings } from './readings.js';
import { UNTAKEN, type Entry, type Sight, type WorktreeEntries } from './rowShapes.js';
import { DIRECTIONS, keyOf } from './rowOrder.js';
import { mainEntry, externalEntry, recordedEntry, listed } from './rowEntries.js';

export type RowReaderOptions = {
  readonly checks?: MergeChecks;
  readonly pending?: (projectId: number) => Effect.Effect<readonly PendingMerge[], { readonly message: string }>;
  readonly pendingMoved?: ProjectMoved;
  readonly progress?: ActProgress;
  readonly held?: () => ReadonlySet<string>;
  readonly heldMoved?: ProjectMoved;
};
export type WorktreeRowReader = WorktreeRows['Service'] & FeedReads;
const UNKNOWN: MergeVerdict = { check: 'unknown', held: false, fact: UNTAKEN };
const stored = <A>(work: Effect.Effect<A, StoreFailure | { readonly message: string }>): Effect.Effect<A, WorktreeUnavailable> =>
  Effect.mapError(work, (failure) => new WorktreeUnavailable({ reason: 'storage', message: failure.message }));
const refused = <A>(work: Effect.Effect<A, WorktreeFeedFailure>): Effect.Effect<A, GateRefusal<WorktreeRowsRefusal>> =>
  Effect.catch(work, (failure) => declaredRefusal(WORKTREE_ROWS_REFUSALS)(worktreeRefusal(failure)));
type ListedSnapshot = {
  readonly current: WorktreeMembership;
  readonly listed: WorktreeEntries;
  readonly standing: ReadonlyMap<string, ReadonlyMap<string, ThreadPlacing>>;
  readonly records: ReadonlyMap<string, WorktreeRecord>;
};
const entryOf = (tree: Tree, standing: readonly ThreadPlacing[]): Entry =>
  tree.kind === 'main'
    ? mainEntry(tree.root, tree.sight, tree.headTime, standing)
    : tree.kind === 'external'
      ? externalEntry(tree.root, tree.sight, standing)
      : recordedEntry(tree.record, tree.pending, tree.sight, tree.distance, standing);

export const makeWorktreeRowReader = Effect.fnUntraced(function* (input: {
  readonly recordMoved: ProjectMoved;
  readonly options?: RowReaderOptions;
}) {
  const options = input.options ?? {};
  const coverage = yield* Coverage;
  const checkouts = yield* CheckoutRows;
  const units = yield* MachineUnits;
  const worktrees = yield* WorktreeRecords;
  const { placing, threadsMoved } = yield* WorktreeThreads;
  const metadata = yield* makeMetadata;
  const readings = yield* makeReadings;
  const pending: FeedReads['pending'] = (projectId) =>
    Effect.map(
      stored(options.pending?.(projectId) ?? Effect.succeed([])),
      (merges) => new Map(merges.map((merge) => [merge.rootId as string, merge])),
    );
  const placings: FeedReads['placings'] = (projectId, threadIds) => stored(placing(projectId, threadIds));

  const membership = Effect.fn('WorktreeRows.membership')(function* (
    projectId: number,
  ): Effect.fn.Return<WorktreeMembership, WorktreeFeedFailure> {
    let covering = yield* coverage
      .covered(projectId)
      .pipe(
        Effect.catchTag('ProjectRootsUnavailable', (failure) =>
          failure.reason === 'unestablished' || failure.reason === 'moved' ? coverage.cover(projectId) : Effect.fail(failure),
        ),
      );
    const [records, recordedRoots, merges] = yield* Effect.all(
      [
        stored(units.read((unit) => worktrees.records(projectId, unit))),
        stored(units.read((unit) => worktrees.recordedRoots(projectId, unit))),
        pending(projectId),
      ],
      { concurrency: 3 },
    );
    const canonical = covering.roots.find((root) => root.origin === 'canonical');
    const snapshot = canonical === undefined ? { trees: new Map(), refs: new Map() } : yield* metadata(canonical);
    const paths = new Set(covering.roots.map((root) => root.path));
    if ([...snapshot.trees.keys()].some((path) => !paths.has(path))) covering = yield* coverage.cover(projectId);
    const recorded = new Set<string>(recordedRoots);
    const external = covering.roots.filter((root) => root.origin !== 'canonical' && !recorded.has(root.rootId));
    const roots = [...(canonical === undefined ? [] : [canonical]), ...records, ...external];
    const [states, verdicts] = yield* Effect.all(
      [
        readings.restore(projectId, roots),
        options.checks === undefined
          ? Effect.succeed(new Map<string, MergeVerdict>())
          : stored(options.checks.saved(records.map((record) => record.path))),
      ],
      { concurrency: 2 },
    );
    return { canonical, records, external, pending: merges, metadata: snapshot, states, verdicts };
  });

  const reads: FeedReads = {
    membership,
    pending,
    placings,
    follow: (rootId) => checkouts.follow(rootId),
    state: readings.read,
    verdict: (path, tip, head, start) =>
      options.checks === undefined ? Effect.succeed(UNKNOWN) : stored(options.checks.standing(path, tip, head, start)),
    checked: (listener) => options.checks?.onTaken(listener) ?? (() => undefined),
    topology: checkouts.checkoutsMoved,
  };
  const copies = Option.getOrUndefined(yield* Effect.serviceOption(WorktreeHeld));
  const held = options.held ?? copies?.held ?? (() => new Set<string>());
  const restored = Effect.fnUntraced(function* (projectId: number) {
    const [current, placing] = yield* Effect.all([membership(projectId), placings(projectId)], { concurrency: 2 });
    const membershipState = makeFeedMembership({
      reads,
      poke: () => undefined,
      changed: () => undefined,
      leaving: () => false,
      visible: () => new Set(),
      held,
    });
    yield* membershipState.reconcile(current);
    membershipState.placeAll(placing);
    const entries = [...membershipState.state.trees].map(([rootId, tree]) =>
      entryOf(tree, [...(membershipState.state.standing.get(rootId)?.values() ?? [])]),
    );
    const first = entries.find((entry) => entry.row.kind === 'main') ?? null;
    return {
      current,
      listed: listed(
        first,
        entries.filter((entry) => entry !== first),
        placing,
      ),
      standing: membershipState.state.standing,
      records: new Map(current.records.map((record) => [record.rootId as string, record])),
    } satisfies ListedSnapshot;
  });
  const enrich = Effect.fnUntraced(function* (
    entry: Entry,
    snapshot: ListedSnapshot,
    fresh: boolean,
  ): Effect.fn.Return<Entry, WorktreeUnavailable> {
    const { current } = snapshot;
    const row = entry.row;
    const root: ProjectRoot = {
      projectId: current.canonical?.projectId ?? 0,
      rootId: row.rootId,
      path: row.folder,
      origin: row.kind === 'main' ? 'canonical' : 'worktree',
    };
    const metadata = current.metadata.trees.get(row.folder) ?? { head: null, ref: null, headTime: null, present: row.kind === 'main' };
    if (!metadata.present || options.progress?.leaving(row.rootId) === true) return entry;
    const record = row.kind === 'tagma' ? snapshot.records.get(row.rootId) : undefined;
    const baseRef = record?.baseBranch == null ? undefined : current.metadata.refs.get(`refs/heads/${record.baseBranch}`);
    const tip = record === undefined ? null : record.baseBranch === null ? record.baseCommit : (baseRef?.head ?? null);
    const taken = yield* Effect.result(
      reads.state({ rootId: row.rootId, path: row.folder, metadata, tip, tipTime: baseRef?.time ?? null, mode: fresh ? 'fresh' : 'page' }),
    );
    if (taken._tag === 'Failure')
      yield* Effect.logWarning('a listed worktree state could not be read', { rootId: row.rootId, reason: taken.failure.message });
    const state = taken._tag === 'Success' ? taken.success : null;
    const sight: Sight = {
      seen: true,
      present: metadata.present,
      gone: !metadata.present,
      metadata,
      read: state?.read ?? null,
      fact: state === null ? undefined : factOf(state, metadata, tip),
    };
    const standing = [...(snapshot.standing.get(row.rootId)?.values() ?? [])];
    if (row.kind === 'main') return mainEntry(root, sight, metadata.headTime, standing);
    if (record === undefined) return externalEntry(root, sight, standing);
    const checks = options.checks;
    const verdict =
      checks === undefined || metadata.head === null || tip === null ? UNKNOWN : yield* stored(checks.last(row.folder, metadata.head, tip));
    if (fresh && checks !== undefined && metadata.head !== null && tip !== null && record.baseBranch !== null) {
      yield* stored(checks.fresh(row.folder, tip, metadata.head));
    }
    const latest =
      fresh && checks !== undefined && metadata.head !== null && tip !== null
        ? yield* stored(checks.last(row.folder, metadata.head, tip))
        : verdict;
    return recordedEntry(
      record,
      current.pending.get(row.rootId) ?? null,
      sight,
      { ahead: state?.ahead ?? null, behind: state?.behind ?? null, check: latest.check, held: latest.held, fact: latest.fact },
      standing,
    );
  });

  const windows = yield* makeWindows({
    reads,
    recorded: input.recordMoved,
    threadsMoved,
    options: {
      pendingMoved: options.pendingMoved,
      progress: options.progress,
      held,
      heldMoved: options.heldMoved ?? copies?.moved,
    },
  });
  const owner = WorktreeRows.of({
    list: Effect.fn('WorktreeRows.list')(function* (projectId, asked): Effect.fn.Return<
      WorktreeListAnswer,
      GateRefusal<WorktreeRowsRefusal>
    > {
      const question: PageQuestion = { operation: 'list_worktrees', selection: { projectId }, order: WORKTREES.order };
      const at = asked.cursor === undefined ? null : readCursor(asked.cursor, question);
      if (at !== null && 'refused' in at) return yield* cursorRefusal(at.refused);
      const snapshot = yield* refused(restored(projectId));
      const { listed } = snapshot;
      const rest = at === null ? listed.entries : pastKey(listed.entries, keyOf, DIRECTIONS, at.at);
      const size = pageRows(asked.limit, WORKTREES, ceilingOf(WORKTREES));
      const cut = page({ rows: rest.slice(0, size + 1), asked: size, keyOf, question, total: listed.entries.length });
      const rows = yield* refused(
        Effect.forEach(
          cut.rows,
          (entry) => Effect.map(enrich(entry, snapshot, false), (read) => ({ ...read.row, index: entry.row.index })),
          { concurrency: 3 },
        ),
      );
      return { rows, elsewhere: listed.elsewhere, shown: cut.shown, total: listed.entries.length, next: cut.next, complete: cut.complete };
    }),
    rows: Effect.fn('WorktreeRows.rows')(function* (projectId) {
      const work = Effect.gen(function* () {
        const snapshot = yield* restored(projectId);
        return yield* Effect.forEach(
          snapshot.listed.entries,
          (entry) => Effect.map(enrich(entry, snapshot, true), (read) => ({ ...read.row, index: entry.row.index })),
          { concurrency: 3 },
        );
      });
      return yield* Effect.catch(work, (failure) => declaredRefusal(WORKTREE_ROW_REFUSALS)(worktreeRefusal(failure)));
    }),
    subscribe: (projectId, window: WorktreeWindow) =>
      windows(projectId, window).pipe(
        Stream.catch((failure) => Stream.fromEffect(declaredRefusal(WORKTREE_ROWS_REFUSALS)(worktreeRefusal(failure)))),
      ),
  });
  return { ...reads, ...owner } satisfies WorktreeRowReader;
});
