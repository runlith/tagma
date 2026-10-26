import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { admitted } from '../../platform/contract/service/routed.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { threadIdOf } from '../../platform/contract/wire/actor.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { FinishingPlace } from '../../worktrees/contract/wire/mergeTypes.js';
import type { FinishFailure } from '../../worktrees/contract/wire/failures.js';
import { finishingRefusal } from '../../worktrees/contract/service/refusals.js';
import { requesterOf } from '../../worktrees/contract/service/requester.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { CallPlace } from '../../platform/contract/service/place.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { custodianOf } from '../../executions/terminals/principals.js';
import { TerminalRefused } from '../../executions/contract/wire/refusals.js';
import { principalOf } from '../../executions/terminals/principals.js';
import type { WorktreeMergeAnswer } from '../contract/wire/merge.js';
import { LANDING_OPERATIONS } from '../contract/wire/operations.js';
import { Merges, PendingMerges } from '../contract/service/merges.js';

type Declared = typeof LANDING_OPERATIONS;

const landing =
  <K extends keyof Declared>(id: K) =>
  <A, R>(work: Effect.Effect<A, FinishFailure, R>) =>
    admitted(LANDING_OPERATIONS[id])(Effect.mapError(work, finishingRefusal));

const placeFor = <K extends keyof Declared>(id: K, withBase: boolean) =>
  Effect.fn('landing.placeFor')(function* (input: { readonly rootId: RootId }) {
    const call = yield* yield* CurrentProject;
    return yield* landing(id)((yield* Merges).placeOf(call.project.id, input.rootId, withBase));
  });

const mergePlace = Effect.fn('landing.mergePlace')(function* (input: { readonly rootId: RootId }) {
  const here = yield* CallPlace;
  const root = yield* (yield* CheckoutPaths)
    .rootAcross(input.rootId, here?.projectId ?? null)
    .pipe(Effect.mapError((failure) => new GateRefusal('files', failure.reason, ['read the checkout again'])));
  if (root === null)
    return yield* new GateRefusal('root-unproven', `${input.rootId} is not a registered checkout`, ['name a registered worktree']);
  const place = yield* landing('merge_worktree')((yield* Merges).placeOf(root.projectId, input.rootId, true));
  return { projectId: root.projectId, checkout: place.base, branch: null };
});

export const MERGE_PAIRS = {
  check_worktree_merge: pair(
    LANDING_OPERATIONS.check_worktree_merge,
    body(LANDING_OPERATIONS.check_worktree_merge, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const merge = yield* landing('check_worktree_merge')((yield* Merges).checkMerge(call.project.id, input.rootId));
        return { status: 'ok' as const, merge };
      }),
    }),
  ),

  merge_worktree: pair(
    LANDING_OPERATIONS.merge_worktree,
    body<typeof LANDING_OPERATIONS.merge_worktree, FinishingPlace | null, CurrentProject | Merges | PendingMerges | CheckoutPaths>(
      LANDING_OPERATIONS.merge_worktree,
      {
        place: mergePlace,
        prepare: Effect.fn('merge_worktree.terms')(function* (input, caller: Caller) {
          const call = yield* yield* CurrentProject;
          return yield* landing('merge_worktree')(
            (yield* Merges).termsOf(call.project.id, input.rootId, input.after ?? 'keep', threadIdOf(caller.actor)),
          );
        }),
        execute: Effect.fnUntraced(function* (input, _place: FinishingPlace | null, caller: Caller) {
          const call = yield* yield* CurrentProject;
          const end = requesterOf(caller, call.project.id);
          const merging = custodianOf(caller.actor, call.project.id);
          const merged: Effect.Effect<WorktreeMergeAnswer, FinishFailure> = (yield* PendingMerges).merge(
            call.project.id,
            input.rootId,
            {
              mode: input.mode ?? 'merge',
              message: input.message ?? null,
              after: input.after ?? 'keep',
              end: end === undefined ? null : principalOf(end),
              caller: merging instanceof TerminalRefused ? undefined : merging,
            },
            input.whenBaseFree === true,
          );
          const answer = yield* landing('merge_worktree')(merged);
          return 'queued' in answer ? { status: 'queued' as const, ...answer } : { status: 'merged' as const, ...answer };
        }),
      },
    ),
  ),

  cancel_worktree_merge: pair(
    LANDING_OPERATIONS.cancel_worktree_merge,
    body(LANDING_OPERATIONS.cancel_worktree_merge, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const cancelled = yield* landing('cancel_worktree_merge')((yield* PendingMerges).cancel(call.project.id, input.rootId));
        return { status: 'cancelled' as const, ...cancelled };
      }),
    }),
  ),

  open_worktree_pr: pair(
    LANDING_OPERATIONS.open_worktree_pr,
    body<typeof LANDING_OPERATIONS.open_worktree_pr, FinishingPlace | null, CurrentProject | Merges>(LANDING_OPERATIONS.open_worktree_pr, {
      prepare: placeFor('open_worktree_pr', false),
      execute: Effect.fnUntraced(function* (input, _place: FinishingPlace | null) {
        const call = yield* yield* CurrentProject;
        const opened = yield* landing('open_worktree_pr')(
          (yield* Merges).openPullRequest(call.project.id, input.rootId, {
            title: input.title,
            body: input.body,
            draft: input.draft,
          }),
        );
        return { status: 'opened' as const, ...opened };
      }),
    }),
  ),
};
