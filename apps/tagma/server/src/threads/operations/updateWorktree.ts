import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { admitted } from '../../platform/contract/service/routed.js';
import { threadIdOf } from '../../platform/contract/wire/actor.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { FinishingPlace } from '../../worktrees/contract/wire/mergeTypes.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { WorktreeUpdates } from '../contract/service/worktreeUpdates.js';
import { WorktreeRetirement } from '../../worktrees/contract/service/retirement.js';
import { finishingRefusal } from '../../worktrees/contract/service/refusals.js';
import type { FinishFailure } from '../../worktrees/contract/wire/failures.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { UPDATE_WORKTREE_OPERATIONS } from '../contract/wire/operations/updateWorktree.js';

const refused = <A, R>(work: Effect.Effect<A, FinishFailure, R>) =>
  admitted(UPDATE_WORKTREE_OPERATIONS.update_worktree)(Effect.mapError(work, finishingRefusal));

const placeOf = Effect.fn('update_worktree.place')(function* (input: { readonly rootId: RootId }) {
  const call = yield* yield* CurrentProject;
  return yield* refused((yield* WorktreeRetirement).place(call.project.id, input.rootId, false));
});

export const UPDATE_WORKTREE_PAIRS = {
  update_worktree: pair(
    UPDATE_WORKTREE_OPERATIONS.update_worktree,
    body<typeof UPDATE_WORKTREE_OPERATIONS.update_worktree, FinishingPlace | null, CurrentProject | WorktreeRetirement | WorktreeUpdates>(
      UPDATE_WORKTREE_OPERATIONS.update_worktree,
      {
        prepare: placeOf,
        execute: Effect.fnUntraced(function* (input, _place: FinishingPlace | null, caller: Caller) {
          const call = yield* yield* CurrentProject;
          const handed = yield* refused((yield* WorktreeUpdates).update(call.project.id, input.rootId, threadIdOf(caller.actor)));
          return { status: 'handed' as const, ...handed };
        }),
      },
    ),
  ),
};
