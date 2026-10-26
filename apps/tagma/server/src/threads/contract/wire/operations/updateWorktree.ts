import { Schema } from 'effect';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from '../../../../workspace/contract/wire/refusals.js';
import { GIT_REFUSALS } from '../../../../platform/contract/wire/refusal.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { WorktreeUpdateHanded } from '../../../../worktrees/contract/wire/retirement.js';
import type { FinishingPlace } from '../../../../worktrees/contract/wire/mergeTypes.js';
import { PLACE, rootId, subjects } from '../../../../worktrees/contract/wire/operations/retirement.js';
import { ASKS_IN_REVIEW } from '../../../../platform/contract/wire/conditions.js';

export const UPDATE_WORKTREE_OPERATIONS = {
  update_worktree: operation('update_worktree', {
    approval: ASKS_IN_REVIEW,
    doors: { http: true },
    tool: { capability: 'worktrees', needs: ['shared'] },
    callers: 'any',
    subject: 'none',
    place: 'project',
    graph: 'none',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ handed: WorktreeUpdateHanded.fields }),
    meaning: "Hand a worktree's lead thread the work of merging its base branch in and resolving the conflicts.",
    grammar: `The lead thread is the earliest thread standing in the worktree whose parent does not stand there too; where none stands, the act starts one in the worktree and that thread leads. Nothing is merged here: the thread receives the ask — a task owed an answer when a thread calls, a message when the operator does — and resolves the conflicts in the files, where its own checks and commits apply. \`no-lead-thread\` refuses only when that start is refused, with the start's way out.`,
    input: Schema.Struct({ rootId }),
    refusals: [...PLACE, 'folder-missing', 'no-branch', 'no-base-branch', 'no-lead-thread'],
    subjects,
    confirmation: (input, prepared?: FinishingPlace | null) => ({
      summary: `Ask the lead thread of ${prepared?.folder ?? input.rootId} to merge its base in?`,
    }),
    confirmLabel: 'Hand update',
    presentation: {
      running: 'Handing a worktree its update',
      done: 'Handed a worktree its update',
    },
  }),
};

export type UpdateWorktreeOperationId = keyof typeof UPDATE_WORKTREE_OPERATIONS;
export const UPDATE_WORKTREE_OPERATION_IDS = Object.keys(UPDATE_WORKTREE_OPERATIONS) as readonly UpdateWorktreeOperationId[];
