import { WORKTREES_ENTRY_KINDS } from '@tagma/server/worktrees/contract/wire/entryKinds';
import { WORKTREE_ENTRY, type WorktreeEntry } from '@tagma/server/worktrees/contract/wire/entries';
import type { ThreadContextChangeEntry } from '@runlith/agent/transcript/entries';
import { productId, productEntry } from '@runlith/chat-ui/entries';
import { productKind } from '@runlith/chat-ui/EntryKinds.svelte';
import { productRecord } from '../native/records.js';
import { WORKTREE_MOVE, worktreeMove, type WorktreeMove } from './worktreeMove.js';
import { WORKTREE_PLACE, type WorktreePlace } from './worktreePlace.js';

export const worktreeMoveId = productId<WorktreeMove>(WORKTREE_MOVE);
const worktreePlaceId = productId<WorktreePlace>(WORKTREE_PLACE);
export const worktreeMoveKind = productKind(worktreeMoveId);
export const worktreePlaceKind = productKind(worktreePlaceId);
export const entryKinds = WORKTREES_ENTRY_KINDS;
export const productRecords = [
  productRecord<ThreadContextChangeEntry>('context-change', (entry, base) => {
    const moved = worktreeMove(entry);
    return moved === null ? null : productEntry(worktreeMoveId, base, moved);
  }),
  productRecord<WorktreeEntry>(WORKTREE_ENTRY, (entry, base) =>
    entry.event === 'moved'
      ? productEntry(worktreeMoveId, base, { rootId: entry.rootId, status: 'published', detail: null })
      : productEntry(worktreePlaceId, base, entry),
  ),
];
