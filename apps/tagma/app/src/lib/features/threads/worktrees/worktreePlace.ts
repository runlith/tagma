import type { WorktreeEntry } from '@tagma/server/worktrees/contract/wire/entries';

export const WORKTREE_PLACE = 'worktree-place';
export type WorktreePlace = Extract<WorktreeEntry, { readonly event: 'created' | 'setup' | 'merged' }>;
