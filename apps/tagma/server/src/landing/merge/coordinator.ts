import { Effect } from 'effect';
import { MergeGit } from '../contract/service/mergeGit.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { ActChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
import { FinishingGate, WorktreeRetirement } from '../../worktrees/contract/service/retirement.js';
import type { ActProgress } from '../../worktrees/contract/service/progress.js';
import type { MergeChecks } from '../../worktrees/contract/service/mergeChecks.js';
import type { ProjectRoot, ProjectRootFailure } from '../../workspace/contract/wire/coverage.js';
import { type FinishingGuards, UNCOMMITTED, WorktreeThreads } from '../../worktrees/contract/service/finishingGate.js';
import type { Raised } from '@runlith/agent/permissions';
import { pathsOf, runningWords } from '../../worktrees/retirement/finishing.js';
import { Merges } from '../contract/service/merges.js';
import type { BranchGraphChanges } from '../contract/service/graphChanges.js';
import type { GraphCarried, GraphHeld, GraphSettled } from '../contract/service/graphSyncing.js';
import type { TreeReady, TreeSync } from '../../graph/contract/service/delivery.js';
import { inGraphTree } from '../../graph/contract/wire/storage.js';
import { checkMerge } from './check.js';
import { integrate } from './integrate.js';
import { makeMergeCommits } from './modes.js';
import { writes } from '../../platform/contract/service/writes.js';
import { MergeReceipts } from '../contract/service/receipts.js';
import { MergeNotice, type NoticeWrite } from '../contract/service/mergeNotice.js';
import type { MergeReceipt } from '../contract/wire/merge.js';
import { basisOf, readStanding } from '../queue/basis.js';
import { PendingBoard } from '../queue/board.js';
import { landingIntent, mergeReceipt, worktreePendingMerge } from '../store/tables.js';
import { type GhRun, openPullRequest } from './pullRequest.js';
import { recoverMerges } from './recovery.js';
import { type Doubted, mergePublications } from './publication.js';
import { type GraphSyncRun, mergeTail } from './tail.js';
import { intentLifecycle } from '../store/intentLifecycle.js';
import { type MergeRequestRow, mergeRequests } from '../store/mergeRequests.js';

const settling = writes('Merges.settle', [mergeReceipt, worktreePendingMerge, landingIntent]);

const stopping = writes('Merges.recover', [worktreePendingMerge]);

const SETTLE_ATTEMPTS = 3;

export const makeMergeCoordinator = Effect.fnUntraced(function* (options: {
  readonly covered: (projectId: number) => Effect.Effect<readonly ProjectRoot[], ProjectRootFailure>;
  readonly checks: MergeChecks;
  readonly guards: FinishingGuards;
  readonly progress: ActProgress;
  readonly announce: (projectId: number) => void;
  readonly graph: GraphSyncRun;
  readonly sync: TreeSync;
  readonly ready?: TreeReady;
  readonly held?: GraphHeld;
  readonly gh: GhRun;
  readonly graphChanges?: BranchGraphChanges;
  readonly rules?: ActChecks;
  readonly carried?: GraphCarried;
  readonly settled?: GraphSettled;
}) {
  const git = yield* MergeGit;
  const units = yield* MachineUnits;
  const { db } = yield* MachineStore;
  const lifecycle = intentLifecycle(db, units);
  const requests = mergeRequests(db, units);
  const records = yield* WorktreeRecords;
  const checkouts = yield* CheckoutRows;
  const holdings = yield* CheckoutHoldings;
  const gate = yield* FinishingGate;
  const retirement = yield* WorktreeRetirement;
  const { covered, checks, guards, progress, announce } = options;
  const threads = yield* WorktreeThreads;
  const receipts = yield* MergeReceipts;
  const pending = (yield* PendingBoard).store;
  const notice = yield* MergeNotice;
  const commits = yield* makeMergeCommits();
  const { graph, gh } = options;
  const recorded = (receipt: MergeReceipt) => (unit: Parameters<MergeReceipts['Service']['recorded']>[0]) =>
    receipts.recorded(unit, receipt.rootId, receipt.commit);
  const settle = Effect.fn('Merges.settle')(function* (projectId: number, receipt: MergeReceipt, key: string, asked: Date) {
    for (let attempt = 1; ; attempt += 1) {
      const notes = yield* Effect.forEach(receipt.addressees, (threadId) => notice.prepare(threadId, receipt, recorded(receipt)));
      const settled = yield* Effect.result(
        units.write(settling, (unit) =>
          Effect.gen(function* () {
            for (const note of notes.filter((one): one is NoticeWrite => one !== null)) yield* note(unit);
            yield* receipts.record(unit, projectId, receipt);
            yield* pending.dropAsked(receipt.rootId, asked, unit);
            yield* requests.close(unit, key);
          }),
        ),
      );
      if (settled._tag === 'Success') return;
      if (settled.failure._tag !== 'MergeNoticeConflict' || attempt >= SETTLE_ATTEMPTS) return yield* settled.failure;
    }
  });
  const publications = mergePublications(git, lifecycle, requests);
  const tail = mergeTail(git, checkouts, threads, retirement, graph, settle, requests, announce, options.rules);
  const aborting = recoverMerges(git, units, records, covered, gate, checkouts);
  const standingAt = readStanding(checkouts, holdings);
  const doubted: Doubted = Effect.fnUntraced(function* (request: MergeRequestRow, since: Date, reason: string) {
    const read = yield* Effect.result(standingAt(request.rootId, request.baseRootId));
    if (read._tag === 'Failure')
      yield* Effect.logWarning('a queued merge stopped as unresolved goes at its next judgement', {
        rootId: request.rootId,
        reason: read.failure.message,
      });
    const stoppedOn = read._tag === 'Success' ? basisOf('finishing-cut', read.success) : null;
    const stopped = yield* Effect.result(
      units.write(stopping, (unit) =>
        Effect.gen(function* () {
          const standing = yield* pending.byRoot(request.rootId, unit);
          if (standing === null || standing.state !== 'waiting' || standing.queuedAt > since) return null;
          yield* pending.replace(
            standing,
            {
              ...standing,
              state: 'stopped',
              stoppedOn,
              refusal: {
                code: 'finishing-cut',
                message: `an earlier try of this merge may have published ${request.source} into ${request.baseBranch}, and that is unresolved, so it is not tried again: ${reason}`,
                unblock: [`read ${request.baseBranch} before merging again: read_checkout_history`],
              },
            },
            unit,
          );
          return standing.projectId;
        }),
      ),
    );
    if (stopped._tag === 'Success' && stopped.success !== null) announce(stopped.success);
    if (stopped._tag === 'Failure')
      yield* Effect.logWarning('a queued merge whose earlier try is unresolved could not be stopped', {
        rootId: request.rootId,
        reason: stopped.failure.message,
      });
  });

  return Merges.of({
    checkMerge: checkMerge(git, guards, checks, options.graphChanges),
    merge: integrate(git, guards, gate, checkouts, holdings, checks, publications, tail, progress, commits, {
      sync: options.sync,
      ready: options.ready,
      held: options.held,
      rules: options.rules,
      carried: options.carried,
      settled: options.settled,
    }),
    openPullRequest: openPullRequest(git, guards, gate, checkouts, gh, progress),
    recover: Effect.fnUntraced(function* () {
      const aborted = yield* aborting();
      const publishing = yield* publications.recover(gate, tail, doubted);
      return {
        aborted: aborted.aborted,
        published: publishing.published,
        uncertain: publishing.uncertain,
        unread: [...aborted.unread, ...publishing.unread.map((one) => ({ projectId: null, ...one }))],
      };
    }),
    placeOf: guards.placeOf,
    termsOf: Effect.fnUntraced(function* (projectId, rootId, after, asking) {
      const place = yield* guards.placeOf(projectId, rootId, true);
      const retiring = after !== 'keep';
      const busy = yield* guards.working(projectId, rootId, retiring ? asking : null);
      const leftovers = pathsOf(yield* checkouts.read(rootId), UNCOMMITTED)
        .map((entry) => entry.path)
        .filter((path) => !inGraphTree(path));
      const uses = retiring ? yield* guards.holders(rootId) : [];
      const consents: Raised[] = [
        ...(busy.length === 0
          ? []
          : [
              {
                condition: 'agent-running',
                fact: `${runningWords(busy)}: the merge takes the branch as committed after delivering its pending graph${retiring ? ', and the deletion after it stops them' : ''}`,
              },
            ]),
        ...(leftovers.length === 0
          ? []
          : [
              {
                condition: 'uncommitted',
                fact: `${leftovers.length} path${leftovers.length === 1 ? '' : 's'} of this worktree hold uncommitted lines (${leftovers.slice(0, 8).join(', ')}): they stay out of the merge${retiring ? ', and the deletion after it commits them on the branch' : ''}`,
              },
            ]),
        ...(uses.length === 0
          ? []
          : [
              {
                condition: 'root-in-use',
                fact: `${uses.map((use) => `${use.consumer.kind} ${use.consumer.id}`).join(', ')} still ${uses.length === 1 ? 'holds' : 'hold'} this worktree: ended before the deletion removes the folder`,
              },
            ]),
      ];
      return { ...place, consents };
    }),
    baseRootOf: Effect.fnUntraced(function* (projectId, rootId) {
      const record = yield* guards.recorded(projectId, rootId);
      if (record.baseBranch === null) return null;
      return (yield* guards.baseCheckout(projectId, record.baseBranch, rootId)).root.rootId;
    }),
  });
});
