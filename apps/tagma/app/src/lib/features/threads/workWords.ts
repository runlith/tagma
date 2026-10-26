import type { AgentWaiting } from '@runlith/agent/AgentPhase';
import { WAITING_REASONS, type WaitingReason } from '@tagma/server/threads/contract/wire/waiting';

export const queuedCalls = (count: number): string => `${count} queued`;

const WAITING_WORDS: Readonly<Record<WaitingReason, string>> = {
  [WAITING_REASONS.graph]: 'Opening the graph',
  [WAITING_REASONS.setup]: 'Waiting for setup',
  [WAITING_REASONS.process]: 'Starting the agent',
  [WAITING_REASONS.stopping]: 'Waiting for the agent to stop its last turn',
};

const known = (reason: string): reason is WaitingReason => Object.hasOwn(WAITING_WORDS, reason);

export function waitingWords(waiting: AgentWaiting): string | null {
  if (!known(waiting.reason)) return null;
  const said = WAITING_WORDS[waiting.reason];
  return waiting.place === null ? said : `${said} of ${waiting.place}`;
}
