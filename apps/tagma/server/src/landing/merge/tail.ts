import { Clock, Effect } from 'effect';
import type { MergeGit } from '../contract/service/mergeGit.js';
import type { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { actorOfPrincipal } from '../../executions/terminals/principals.js';
import type { ActChecks } from '../../enforcement/contract/service/ruleChecks.js';
import type { MergedAfter } from '../../worktrees/contract/wire/entries.js';
import type { FinishingThreads } from '../../worktrees/contract/service/finishingGate.js';
import type { WorktreeRetirement } from '../../worktrees/contract/service/retirement.js';
import { finishRefusalOf } from '../../worktrees/retirement/finishing.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { AfterMerged, MergeReceipt } from '../contract/wire/merge.js';
import type { GraphSync } from '../contract/wire/receipt.js';
import type { MergeNoticeFailure } from '../contract/service/mergeNotice.js';
import type { MergeRequestRow, MergeRequests } from '../store/mergeRequests.js';

export type GraphSyncRun = (projectId: number, checkout: string) => Effect.Effect<GraphSync>;

export type MergeSettlement = (
  projectId: number,
  receipt: MergeReceipt,
  key: string,
  asked: Date,
) => Effect.Effect<void, StoreFailure | MergeNoticeFailure>;

export type Published = {
  readonly projectId: number;
  readonly key: string;
  readonly request: MergeRequestRow;
  readonly asked: Date;
  readonly checkout: string;
  readonly commit: string;
  readonly from: string;
  readonly paths: readonly string[];
};

export type Tailed = {
  readonly graph: GraphSync;
  readonly after: AfterMerged;
  readonly branch: string;
  readonly closed: boolean;
  readonly unrecorded: readonly string[];
};

const mergedAfter = (after: AfterMerged): MergedAfter => ({
  act: after.act,
  outcome: after.refusal !== null ? 'refused' : after.deleted?.branch.status === 'kept' ? 'branch-kept' : 'done',
  reason: after.refusal?.message ?? (after.deleted?.branch.status === 'kept' ? after.deleted.branch.reason : null),
});

const told = (act: MergedAfter): AfterMerged => ({
  act: act.act,
  deleted: null,
  refusal:
    act.outcome === 'refused'
      ? {
          code: 'finishing-cut',
          message: act.reason ?? `the ${act.act} after the merge was refused`,
          unblock: ['read the worktree: list_worktrees'],
        }
      : null,
});

const actorOf = (principal: MergeRequestRow['end'], projectId: number): TerminalActor | undefined =>
  principal === null ? undefined : (actorOfPrincipal(principal, projectId) ?? undefined);

export const mergeTail = (
  git: MergeGit['Service'],
  checkouts: CheckoutRows['Service'],
  threads: FinishingThreads,
  retirement: WorktreeRetirement['Service'],
  graph: GraphSyncRun,
  settle: MergeSettlement,
  requests: MergeRequests,
  announce: (projectId: number) => void,
  rules: ActChecks | undefined,
) => {
  const afterAct = Effect.fnUntraced(function* (published: Published, unrecorded: string[]) {
    const { projectId, key, request } = published;
    const kept: AfterMerged = { act: request.after, deleted: null, refusal: null };
    if (request.after === 'keep') return kept;
    if (request.afterDone !== null) return told(request.afterDone);
    if (request.afterState === 'running') {
      return told({
        act: request.after,
        outcome: 'refused',
        reason: `the server stopped while the ${request.after} after the merge ran, so whether it finished is unknown and it was not repeated`,
      });
    }
    const marked = yield* Effect.result(requests.afterRunning(key));
    if (marked._tag === 'Failure') {
      return told({
        act: request.after,
        outcome: 'refused',
        reason: `the ${request.after} was not started, because its start could not be recorded: ${marked.failure.message}`,
      });
    }
    const end = actorOf(request.end, projectId);
    const after = yield* Effect.match(retirement.delete(projectId, request.rootId, end), {
      onFailure: (failure): AfterMerged => ({ ...kept, refusal: finishRefusalOf(failure) }),
      onSuccess: (deleted): AfterMerged => ({ ...kept, deleted }),
    });
    const recorded = yield* Effect.result(requests.afterDone(key, mergedAfter(after)));
    if (recorded._tag === 'Failure') unrecorded.push(`the outcome of the ${request.after} was not recorded: ${recorded.failure.message}`);
    return after;
  });

  const sourceMoved = Effect.fnUntraced(function* (published: Published, unrecorded: string[]) {
    const { key, request, commit, checkout } = published;
    if (request.mode !== 'rebase' || request.sourceState === 'none') return request.source;
    const standing = request.sourceState === 'done' || request.sourceState === 'unsynced' ? commit : request.source;
    if (request.sourceState === 'done' || request.sourceState === 'unsynced' || request.sourceState === 'refused') {
      if (request.sourceReason !== null) unrecorded.push(request.sourceReason);
      return standing;
    }
    const record = Effect.fnUntraced(function* (state: 'ref' | 'done' | 'unsynced' | 'refused', reason: string | null) {
      const saved = yield* Effect.result(requests.sourceSettled(key, state, reason));
      if (saved._tag === 'Failure') unrecorded.push(`the move of ${request.branch} was not recorded: ${saved.failure.message}`);
    });
    const ref = `refs/heads/${request.branch}`;
    if (request.sourceState === 'pending') {
      const moved = yield* Effect.match(
        git.advance({ checkout, ref, base: request.source, commit }, 'tagma: branch replayed onto its base'),
        { onFailure: (failure) => ({ advanced: false, reason: failure.message }), onSuccess: (advanced) => ({ advanced, reason: null }) },
      );
      if (!moved.advanced) {
        const read = yield* Effect.match(git.resolve(checkout, ref), {
          onFailure: (failure) => ({ commit: null, reason: failure.message }),
          onSuccess: (commit) => ({ commit, reason: null }),
        });
        const standingNow = read.commit;
        if (standingNow !== commit) {
          const reason = `${request.branch} was not moved to ${commit}, because it no longer stands at ${request.source}${standingNow === null ? '' : ` and now stands at ${standingNow}`}${moved.reason === null ? '' : `: ${moved.reason}`}${read.reason === null ? '' : `; its branch could not be read back: ${read.reason}`}`;
          unrecorded.push(reason);
          yield* record('refused', reason);
          return standingNow ?? request.source;
        }
      }
      yield* record('ref', null);
    }
    const settled = yield* git.settle({ checkout: request.sourcePath, ref, base: request.source, commit });
    if (settled.reason !== null) {
      const reason = `${request.branch} moved to ${commit}, but ${settled.reason}`;
      unrecorded.push(reason);
      yield* record('unsynced', reason);
    } else yield* record('done', null);
    return commit;
  });

  return Effect.fn('Merges.tail')(function* (published: Published) {
    const { projectId, key, request, checkout, commit } = published;
    const caller = request.caller ?? undefined;
    const unrecorded: string[] = [];
    const branch = yield* sourceMoved(published, unrecorded);
    const held = (reason: string): Tailed => {
      unrecorded.push(reason);
      announce(projectId);
      return {
        graph: { status: 'unread', reason },
        after: told({
          act: request.after,
          outcome: request.after === 'keep' ? 'done' : 'refused',
          reason: request.after === 'keep' ? null : `the ${request.after} waits for the next start: ${reason}`,
        }),
        branch,
        closed: false,
        unrecorded,
      };
    };
    if (rules !== undefined && !request.rulesAfter) {
      const delivery = yield* rules.after({
        kind: 'tree',
        projectId,
        root: checkout,
        commit,
        paths: published.paths,
        base: published.from,
        caller,
      });
      if (delivery !== undefined && delivery.delivered === false) {
        return held(
          `the rule readings of the merge were not kept by enforcement, so the merge stays open for the next start: ${delivery.reason}`,
        );
      }
      const marked = yield* Effect.result(requests.rulesTold(key));
      if (marked._tag === 'Failure')
        unrecorded.push(`the rule readings of the merge were not marked as delivered: ${marked.failure.message}`);
    }
    yield* checkouts.mark(request.baseRootId);
    yield* checkouts.mark(request.rootId);
    const placed = yield* Effect.result(threads.placedIn(projectId, request.rootId));
    if (placed._tag === 'Failure') {
      return held(
        `the threads placed in ${request.name} could not be read, so no notice was written and the merge stays open for the next start: ${placed.failure.message}`,
      );
    }
    const addressees = placed.success.filter((one) => one.archivedAt === null).map((one) => one.threadId);
    const synced = yield* graph(projectId, checkout);
    const after = yield* afterAct(published, unrecorded);
    const settled = yield* Effect.result(
      settle(
        projectId,
        {
          rootId: request.rootId,
          commit,
          name: request.name,
          branch: request.branch,
          base: request.baseBranch,
          mode: request.mode,
          waitedSince: request.waitedSince === null ? null : request.waitedSince.toISOString(),
          after: request.afterDone ?? mergedAfter(after),
          addressees,
          at: new Date(yield* Clock.currentTimeMillis).toISOString(),
        },
        key,
        published.asked,
      ),
    );
    if (settled._tag === 'Failure')
      unrecorded.push(`the merge left no receipt, so its witness stays open for the next start: ${settled.failure.message}`);
    announce(projectId);
    return { graph: synced, after, branch, closed: settled._tag === 'Success', unrecorded } satisfies Tailed;
  });
};

export type MergeTail = ReturnType<typeof mergeTail>;
