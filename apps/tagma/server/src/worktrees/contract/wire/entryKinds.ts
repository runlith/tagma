import type { ThreadEntryKind } from '@runlith/agent/transcript/kinds';
import { WORKTREE_ENTRY, WorktreeEntry } from './entries.js';

export const WORKTREES_ENTRY_KINDS: readonly ThreadEntryKind[] = [{ type: WORKTREE_ENTRY, schema: WorktreeEntry }];
