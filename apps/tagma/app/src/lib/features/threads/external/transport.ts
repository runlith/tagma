import type { HarnessTransport as Transport } from '@tagma/server/threads/contract/wire/harness/names';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { refusalOf } from '$lib/wire/refusal.js';
import type { ThreadsRepo } from '../Repo.js';
import { threadMark } from '../Life.svelte';
import { proofWords, roadName } from './proofs.js';

export type TransportOffer = {
  readonly label: string;
  readonly hint: string;
  readonly to: Transport | null;
  readonly move: string | null;
  readonly direct: boolean;
  readonly turning: boolean;
};

export const transportName = (transport: Transport | 'native'): string =>
  transport === 'acp' ? 'chat' : transport === 'native' ? 'Tagma' : 'the terminal';

export function transportOffer(row: ThreadListRow): TransportOffer | null {
  const presentation = row.cli?.presentation ?? row.harness?.presentation;
  if (presentation === undefined) return null;
  const movable = presentation.sharedSessions && presentation.terminal;
  const state = threadMark(row).state;
  const turning = state === 'working' || state === 'waiting';
  if (row.cli !== null) {
    if (!movable) return null;
    const { label } = presentation;
    const move = `Open in ${label}`;
    return {
      label: move,
      hint: `Continue this conversation in ${label}, in its own terminal.`,
      to: 'terminal',
      move,
      direct: true,
      turning,
    };
  }
  const harness = row.harness;
  if (harness === null) return null;
  const { label } = presentation;
  const proofs = proofWords(harness);
  if (!movable && proofs === null) return null;
  const to = !movable ? null : harness.transport === 'acp' ? 'terminal' : !presentation.acp ? null : 'acp';
  return {
    label: proofs?.label ?? roadName(harness.transport),
    hint: proofs?.hint ?? (harness.transport === 'terminal' ? `${label} runs in its own terminal.` : `${label} runs here as a chat.`),
    to,
    move: to === null ? null : to === 'acp' ? 'Continue in chat' : 'Open in the terminal',
    direct: false,
    turning,
  };
}

export async function moveTransport(
  threads: ReturnType<typeof ThreadsRepo.use>,
  projectId: number,
  threadId: string,
  to: Transport,
): Promise<string | null> {
  try {
    const moved = await threads.setTransport.run({ id: threadId, projectId, transport: to }, { throwOnError: true });
    return moved !== undefined && 'unstarted' in moved && moved.unstarted !== null
      ? `The CLI did not start: ${moved.unstarted} Your next message starts it.`
      : null;
  } catch (error) {
    return refusalOf(error).reason;
  }
}
