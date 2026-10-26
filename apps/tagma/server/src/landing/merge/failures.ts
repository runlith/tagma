import type { Effect } from 'effect';
import type { WorktreeFinishRefused } from '../../worktrees/contract/wire/failures.js';
import { refused } from '../../worktrees/retirement/finishing.js';

export const conflicting = (baseBranch: string, conflicts: readonly string[]): Effect.Effect<never, WorktreeFinishRefused> =>
  refused('merge-conflicts', `merging into ${baseBranch} conflicts on ${conflicts.join(', ')}`, [
    'hand the worktree its update: update_worktree asks its lead thread, started there if none stands, to merge the base in and resolve the conflicts',
  ]);
