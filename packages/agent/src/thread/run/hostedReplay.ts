import type { Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { agentOriginOf } from '../../agent/AgentSignal';

export type HostedReplay = {
  readonly result: ToolResultPart;
  readonly failed: boolean;
  readonly offered: boolean;
  readonly guides: readonly string[];
};

export const HOSTED_RESULT = 'hosted';

export const messageText = (message: Message): string =>
  typeof message.content === 'string'
    ? message.content
    : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n');

export const introducedIn = (history: readonly Message[], toolCallId: string): boolean => {
  for (let at = history.length - 1; at >= 0; at -= 1) {
    const message = history[at]!;
    if (message.role !== 'assistant' || typeof message.content === 'string') continue;
    if (message.content.some((part) => part.type === 'tool-call' && part.id === toolCallId)) return true;
  }
  return false;
};

export const resultFlags = (part: ToolResultPart): { readonly failed: boolean; readonly offered: boolean } => {
  const held = part.metadata?.[HOSTED_RESULT];
  const record = typeof held === 'object' && held !== null && !Array.isArray(held) ? (held as Readonly<Record<string, unknown>>) : {};
  return {
    failed: record.failed === true || (record.failed === undefined && part.result.type === 'error'),
    offered: record.offered === true,
  };
};

export const replaysOf = (history: readonly Message[]): Map<string, HostedReplay> => {
  const replays = new Map<string, HostedReplay>();
  let last: string[] | null = null;
  for (const message of history) {
    if (message.role === 'tool' && typeof message.content !== 'string') {
      last = [];
      for (const part of message.content) {
        if (part.type === 'tool-result') replays.set(part.id, { result: part, ...resultFlags(part), guides: last });
      }
      continue;
    }
    if (last !== null && agentOriginOf(message) === 'guidance') {
      last.push(messageText(message));
      continue;
    }
    last = null;
  }
  return replays;
};
