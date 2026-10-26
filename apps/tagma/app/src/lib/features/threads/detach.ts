import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { ThreadList } from './List.svelte.js';

export async function detachWithUndo(list: ThreadList, notices: Notices, row: ThreadListRow): Promise<void> {
  const answer = await list.detach(row.id, true);
  if (answer === null) return;
  const name = row.name ?? row.agentId;
  const team = answer.members - 1;
  const text = team > 0 ? `${name} detached with ${team} ${team === 1 ? 'agent' : 'agents'}` : `${name} detached`;
  notices.undoable(text, () => void list.detach(row.id, false), list.life);
}
