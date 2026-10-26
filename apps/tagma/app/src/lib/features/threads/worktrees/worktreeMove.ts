import { targetSourceKey } from '@tagma/server/threads/contract/wire/target';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { ThreadContextChangeEntry } from '@runlith/agent/transcript/entries';

export const WORKTREE_MOVE = 'worktree-move';
export type WorktreeMove = {
  readonly rootId: string;
  readonly status: 'pending' | 'published' | 'denied';
  readonly detail: string | null;
};

const ROOT_SOURCE = targetSourceKey('' as RootId);

export function worktreeMove(entry: ThreadContextChangeEntry): WorktreeMove | null {
  return entry.sourceKey.startsWith(ROOT_SOURCE)
    ? { rootId: entry.sourceKey.slice(ROOT_SOURCE.length), status: entry.status, detail: entry.detail ?? null }
    : null;
}
