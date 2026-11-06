import { makeMergeCommits } from '../merge/modes.js';
import { MergeGit } from '../contract/service/mergeGit.js';
import { makeMergeGit } from '../merge/git.js';
import { Context, Effect, FileSystem } from 'effect';
import { Git } from '@runlith/git/Git';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { type ChangeCheckout, ChangeRecord } from '../../change-record/contract/service/record.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { WorkingOrigins } from '../../workspace/contract/service/places.js';
import type { WorkingOrigin } from '../../workspace/contract/wire/place.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { Merges } from '../contract/service/merges.js';
import { PendingBoard } from '../queue/board.js';
import type { PendingMergeStore, PendingRecord } from '../store/pendingMerges.js';
import { worktreePendingMerge } from '../store/tables.js';
import { writes } from '../../platform/contract/service/writes.js';
import { checkoutLanes, LandingLanes } from '../land/lanes.js';
import { submitWork } from '../land/submit.js';
import { formingOver } from '../land/formed.js';
import { COMMITTING } from '../land/hooks.js';
import { commitIndex, type IndexJudge } from '../land/indexCommit.js';
import { readDelta } from '../land/reshaping.js';
import type { CommitShape } from '../../change-record/contract/service/shape.js';
import { Holdings } from '../../change-record/contract/service/holdings.js';
import { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import { Retirement } from '../../change-record/contract/service/retirement.js';
import { holdingsOver } from '../../change-record/testing/holdings.js';
import { makeCommitLandings } from '../commitLandings.js';
import { makeMergeCoordinator } from '../merge/coordinator.js';
import { preservationCommitLayer } from '../preservation/commit.js';
import { makeMergeQueue } from '../queue/pendingMerges.js';
import { pendingMoves } from '../queue/board.js';
import { mergeReceipts } from '../store/receipts.js';
import { intentLifecycle } from '../store/intentLifecycle.js';
import { mergeRequests } from '../store/mergeRequests.js';
import { landingStore as landingStoreImpl } from '../queue/board.js';
import { GraphSyncing } from '../contract/service/graphSyncing.js';
import type { GraphSync } from '../contract/wire/receipt.js';

export const holdingsAt = Effect.fnUntraced(function* (
  git: Parameters<typeof holdingsOver>[2],
  root: string,
  store: Parameters<typeof holdingsOver>[0],
  units: Parameters<typeof holdingsOver>[1],
  writes?: LineWrites['Service'],
) {
  return yield* holdingsOver(store, units, git, root, undefined, undefined, writes);
});

type Submitted = Parameters<typeof submitWork>;

export const submitOver = Effect.fnUntraced(function* (
  git: Submitted[0],
  root: Submitted[2],
  store: Submitted[3],
  units: Submitted[4],
  origin: WorkingOrigin,
  ...rest: Submitted extends [unknown, unknown, unknown, unknown, unknown, unknown, unknown, ...infer Rest] ? Rest : never
) {
  const rig = yield* holdingsAt(git, root, store, units, yield* LineWrites);
  const caller = { _tag: 'Thread' as const, threadId: ThreadId.make(origin.work.threadId), projectId: origin.work.projectId };
  return yield* submitWork(git, git, root, store, units, origin, caller, ...rest).pipe(
    Effect.provideService(Holdings, rig.holdings),
    Effect.provideService(Retirement, rig.retirement),
    Effect.provideService(GraphSyncing, () => Effect.succeed<GraphSync>({ status: 'unread', reason: 'no graph pool serves this landing' })),
  );
});

export const indexCommitOver = Effect.fnUntraced(function* (
  git: Git['Service'],
  trees: CommitTrees['Service'],
  shape: CommitShape['Service'],
  checkout: ChangeCheckout,
  judge: IndexJudge,
  message: string,
) {
  const changes = yield* ChangeRecord;
  const carrying = yield* Effect.context<FileSystem.FileSystem | LineWrites>();
  return yield* Effect.scoped(
    Effect.flatMap(checkoutLanes, (lanes) =>
      commitIndex(git, trees, lanes, shape, {
        message,
        amend: false,
        kind: COMMITTING,
        withoutFormat: false,
        projectId: checkout.projectId,
        root: checkout.root,
        judge,
        form: formingOver(changes, checkout, carrying),
        job: 'index-over',
        act: { kind: 'operator' },
        landing: () => Effect.void,
        read: (delta) => Effect.orDie(Effect.provide(readDelta(changes, checkout, delta), carrying)),
      }),
    ),
  );
});

export const mergeCoordinator = <R>(
  context: Context.Context<R>,
  pending: PendingMergeStore,
  options: Parameters<typeof makeMergeCoordinator>[0],
) =>
  Effect.provide(
    Effect.flatMap(makeMergeGit, (git) => makeMergeCoordinator(options).pipe(Effect.provideService(MergeGit, git))).pipe(
      Effect.provideService(PendingBoard, { store: pending, moves: pendingMoves() }),
    ),
    context,
  );

export const mergeQueue = (
  units: MachineUnits['Service'],
  store: PendingMergeStore,
  merges: Merges['Service'],
  checkouts: CheckoutRows['Service'],
  holdings: CheckoutHoldings['Service'],
  options: Parameters<typeof makeMergeQueue>[0],
) =>
  makeMergeQueue(options).pipe(
    Effect.provideService(MachineUnits, units),
    Effect.provideService(PendingBoard, { store, moves: pendingMoves() }),
    Effect.provideService(Merges, merges),
    Effect.provideService(CheckoutRows, checkouts),
    Effect.provideService(CheckoutHoldings, holdings),
  );

export const pendingStood = (units: MachineUnits['Service'], store: PendingMergeStore) => (record: PendingRecord) =>
  units.write(writes('PendingMerges.stood', [worktreePendingMerge]), (unit) => store.put(record, unit));

export const underCheckoutLanes = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.scoped(Effect.flatMap(checkoutLanes, (lanes) => Effect.provideService(work, LandingLanes, lanes)));

export const commitLandingsOver = makeCommitLandings;

export const intentsOver = (...input: Parameters<typeof intentLifecycle>) => intentLifecycle(...input);

export const mergeRequestsOver = (...input: Parameters<typeof mergeRequests>) => mergeRequests(...input);

export const receiptsOver = (...input: Parameters<typeof mergeReceipts>) => mergeReceipts(...input);

export const preservationOver = (...input: Parameters<typeof preservationCommitLayer>) => preservationCommitLayer(...input);

export const landingStore = landingStoreImpl;

export const mergeCommits = (
  git: Git['Service'],
  trees: CommitTrees['Service'],
  changes: ChangeRecord['Service'],
  origins: WorkingOrigins['Service'],
  files: FileSystem.FileSystem,
  writes: LineWrites['Service'],
) =>
  Effect.flatMap(makeMergeGit, (port) => makeMergeCommits().pipe(Effect.provideService(MergeGit, port))).pipe(
    Effect.provideService(Git, git),
    Effect.provideService(CommitTrees, trees),
    Effect.provideService(ChangeRecord, changes),
    Effect.provideService(WorkingOrigins, origins),
    Effect.provideService(FileSystem.FileSystem, files),
    Effect.provideService(LineWrites, writes),
  );
