import { Schema } from 'effect';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from '../../../../workspace/contract/wire/refusals.js';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { WORKTREE_READ } from './shape.js';
import { WORKTREES } from '../pages.js';
import { WorktreeListAnswer } from '../rows.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { placedCursor, projectField } from '../../../../platform/contract/wire/place.js';

export const LISTING_OPERATIONS = {
  list_worktrees: operation('list_worktrees', {
    approval: ASKS_NEVER,
    ...WORKTREE_READ,
    answer: arms({ ok: { worktrees: WorktreeListAnswer } }),
    meaning:
      "Read a page of this project's worktrees, main first, with git metadata and saved facts labelled by the HEAD and base they measured. Only page rows read checkout state; check_worktree_merge measures the current merge pair.",
    grammar: `A worktree is a checkout of this project's repository. \`main\` is the canonical checkout; \`tagma\` rows are checkouts a creation made, with the base it was cut from and a hue kept for its life; \`external\` rows are linked checkouts this project covers that no creation recorded: shown and placeable, never finished by Tagma.
Order: main, then waiting on the operator, ready to merge, working, and the rest by last movement, newest first.
\`status\` is derived from metadata and the available facts: missing, conflicts, waiting, working, ready, behind, merged, idle; reading and unread mean a checkout reading is pending or failed. Saved counts and verdicts retain their own witness, so status is not a fresh merge decision. \`check\` is unknown, clean, conflicts, or format-behind while the branch's graph format is being prepared. \`check_worktree_merge\` checks the current pair and answers conflicting paths.
\`agents\` counts the unarchived threads standing there: working, waiting on the operator, finished and not yet opened, and all of them. \`threads\` names every thread standing in a linked worktree; for main, where every thread nothing placed elsewhere stands, it names only the working and waiting ones.
\`reading\` is \`failed\` where git could not read the checkout (status \`unread\`), and \`no-repository\` where the folder holds no git repository: the row stands without a branch, and no worktree can be cut from it.
\`head\` and \`headTime\` come from git metadata. \`stateFact\` and \`mergeFact\` distinguish current, previous, queued and untaken; their HEAD, base, baseTime and takenAt name what the displayed values measured, and stateFact also carries the index stat. Previous facts can refer to an earlier HEAD or base. Moving only the base does not refresh a saved merge verdict. \`ahead\`, \`behind\` and \`diff\` belong to the saved state's base witness; unread facts leave counts null.
The page is selected before checkout state reads; listing never starts a merge check. The page's \`limit\` defaults to the whole standing set up to the worktrees family's measured ceiling; a \`cursor\` continues the same project. The order moves as agents move, so a walk across pages can repeat or skip a row that moved.`,
    input: Schema.Struct({
      project: projectField,
      limit: limitOf(WORKTREES),
      cursor: placedCursor,
    }),
    refusals: ['bad-cursor', 'cursor-stale', 'worktree-unavailable', ...COVERAGE_REFUSALS, ...ROOT_REFUSALS, ...REPOSITORY_REFUSALS],
    subjects: () => [],
    confirmation: () => ({ summary: "Read this project's worktrees?" }),
    confirmLabel: 'Read worktrees',
    presentation: {
      running: 'Reading the worktrees',
      done: 'Read the worktrees',
      many: (count) => `Read the worktrees ${count} times`,
    },
  }),
};

export type ListingOperationId = keyof typeof LISTING_OPERATIONS;
export const LISTING_OPERATION_IDS = Object.keys(LISTING_OPERATIONS) as readonly ListingOperationId[];
