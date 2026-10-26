import { Effect } from 'effect';
import type { FinishingPlace } from '../contract/wire/mergeTypes.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { WorktreeRetirement } from '../contract/service/retirement.js';
import { WorktreeRenames } from '../contract/service/renames.js';
import { requesterOf } from '../contract/service/requester.js';
import { finishing, finishingPlace, retiringTerms } from './finishing.js';
import { RETIREMENT_OPERATIONS } from '../contract/wire/operations/retirement.js';

const OPS = RETIREMENT_OPERATIONS;

export const RETIREMENT_PAIRS = {
  rename_worktree: pair(
    OPS.rename_worktree,
    body<typeof OPS.rename_worktree, FinishingPlace | null, CurrentProject | WorktreeRetirement | WorktreeRenames>(OPS.rename_worktree, {
      prepare: finishingPlace('rename_worktree', false),
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const renamed = yield* finishing('rename_worktree')(
          (yield* WorktreeRenames).rename(call.project.id, input.rootId, input.name, input.remote ?? 'keep'),
        );
        return { status: 'renamed' as const, ...renamed };
      }),
    }),
  ),

  delete_worktree: pair(
    OPS.delete_worktree,
    body(OPS.delete_worktree, {
      prepare: retiringTerms('delete_worktree'),
      execute: Effect.fnUntraced(function* (input, _place, caller) {
        const call = yield* yield* CurrentProject;
        const end = requesterOf(caller, call.project.id);
        const deleted = yield* finishing('delete_worktree')((yield* WorktreeRetirement).delete(call.project.id, input.rootId, end));
        return { status: deleted.branch.status === 'deleted' ? ('deleted' as const) : ('branch-kept' as const), ...deleted };
      }),
    }),
  ),
};
