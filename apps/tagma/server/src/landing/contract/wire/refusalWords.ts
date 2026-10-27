import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'already-merged': 'Branch already merged',
  'base-dirty': 'Base checkout has uncommitted changes',
  'base-held': 'Base lines held by another session',
  'base-mid-operation': 'Git operation under way in base',
  'base-not-checked-out': 'Base branch not checked out',
  'base-staged': 'Base checkout has staged changes',
  'commit-unsigned': 'Commit could not be signed',
  'gh-refused': 'GitHub CLI failed',
  'landing-busy': 'Checkout busy, nothing committed',
  'landing-cut': 'Landing ran too long',
  'merge-conflicts': 'Merge has conflicts',
  'no-base-branch': 'No base branch recorded',
  'no-gh': 'GitHub CLI unavailable',
  'not-pending': 'No merge waiting',
  'rebase-merges': 'Rebase would change the result',
  'reshape-unreadable': 'Hook or formatter changes unreadable',
  'source-dirty': 'Worktree has uncommitted changes',
  'source-held': 'Worktree lines held by another session',
  'task-not-held': 'Declared task is not held by a committing session',
} as const satisfies RefusalWords;
