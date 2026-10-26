import type { Trigger } from '../contract/wire/enforcement.js';

export const TRIGGERS: Readonly<Record<'landing' | 'merge' | 'work', readonly Trigger[]>> = {
  landing: [
    { op: 'submit_work', phase: 'before' },
    { op: 'merge_worktree', phase: 'before' },
  ],
  merge: [{ op: 'merge_worktree', phase: 'before' }],
  work: [
    { op: 'submit_work', phase: 'after' },
    { op: 'merge_worktree', phase: 'after' },
  ],
};
