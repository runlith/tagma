import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';

export function runningSinceOf(row: ThreadListRow): string | null {
  return row.life === 'working' || row.life === 'stalled' ? row.activeRunStartedAt : null;
}

export function stoppableOf(row: ThreadListRow): string | null {
  return row.activeRunId;
}
