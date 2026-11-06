import { agentReaderInput, withAgentReaderInput } from '../agent/AgentSignal';
import type { Message } from '@runlith/llm/schema/messages';
import type { ThreadEventBody } from './events';
import type { ThreadHistory } from './rows';

export type ThreadHistorySplice = { readonly from: number; readonly to: number; readonly insert: readonly Message[] };

export type ThreadHistoryMove =
  | { readonly kind: 'keep'; readonly count: number }
  | { readonly kind: 'compact'; readonly keepFrom: number; readonly messages: readonly Message[] }
  | { readonly kind: 'append'; readonly messages: readonly Message[] }
  | { readonly kind: 'withhold'; readonly inputs: readonly string[]; readonly messages: readonly Message[] }
  | { readonly kind: 'splice'; readonly edits: readonly ThreadHistorySplice[] };

const withholding = (history: readonly Message[], inputs: readonly string[]): Message[] =>
  history.filter((message) => {
    const input = agentReaderInput(message);
    return input === undefined || !inputs.includes(input);
  });

export function moveThreadHistory(event: ThreadEventBody, position?: number): ThreadHistoryMove | null {
  const withdrawn = event.payload.withdrawn;
  if (withdrawn) return { kind: 'keep', count: withdrawn.keepMessages };
  const compacted = event.payload.compacted;
  if (compacted) return { kind: 'compact', keepFrom: compacted.keepFrom, messages: compacted.messages };
  const cuts = event.payload.rewound?.cuts ?? event.payload.branched?.cuts;
  if (cuts) return { kind: 'splice', edits: cuts.map((cut) => ({ from: cut.from, to: cut.to, insert: [] })) };
  const restored = event.payload.restored;
  if (restored) {
    return { kind: 'splice', edits: restored.inserts.map((insert) => ({ from: insert.at, to: insert.at, insert: insert.messages })) };
  }
  const withheld = event.payload.withheld;
  if (withheld?.length) return { kind: 'withhold', inputs: withheld, messages: event.payload.messages ?? [] };
  const messages = event.payload.messages;
  if (!messages?.length) return null;
  if (position === undefined) return { kind: 'append', messages };
  let marked: Message[] | undefined;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const id = agentReaderInput(message);
    if (id === undefined) continue;
    marked ??= [...messages];
    marked[index] = withAgentReaderInput(message, id, position);
  }
  return { kind: 'append', messages: marked ?? messages };
}

export function spliceThreadHistory<T>(
  history: readonly T[],
  edits: readonly { readonly from: number; readonly to: number; readonly insert: readonly T[] }[],
): T[] {
  const spliced: T[] = [];
  let cursor = 0;
  for (const edit of edits) {
    const from = Math.min(history.length, Math.max(cursor, edit.from));
    for (; cursor < from; cursor += 1) spliced.push(history[cursor]!);
    for (const item of edit.insert) spliced.push(item);
    cursor = Math.min(history.length, Math.max(cursor, edit.to));
  }
  for (; cursor < history.length; cursor += 1) spliced.push(history[cursor]!);
  return spliced;
}

export function foldThreadHistory(history: ThreadHistory, event: ThreadEventBody): ThreadHistory {
  const move = moveThreadHistory(event);
  if (move === null) return history;
  switch (move.kind) {
    case 'keep':
      return history.slice(0, move.count);
    case 'compact':
      return [...move.messages, ...history.slice(move.keepFrom)];
    case 'append':
      return [...history, ...move.messages];
    case 'withhold':
      return [...withholding(history, move.inputs), ...move.messages];
    case 'splice':
      return spliceThreadHistory(history, move.edits);
  }
}

export class HistoryFold {
  private messages: Message[];

  constructor(seed: ThreadHistory = []) {
    this.messages = [...seed];
  }

  fold(event: ThreadEventBody, position?: number): void {
    const move = moveThreadHistory(event, position);
    if (move !== null) this.move(move);
  }

  move(move: ThreadHistoryMove): void {
    switch (move.kind) {
      case 'keep':
        this.messages.length = Math.max(0, Math.min(this.messages.length, move.count));
        return;
      case 'compact':
        this.messages = [...move.messages, ...this.messages.slice(move.keepFrom)];
        return;
      case 'append':
        for (const message of move.messages) this.messages.push(message);
        return;
      case 'withhold':
        this.messages = [...withholding(this.messages, move.inputs), ...move.messages];
        return;
      case 'splice':
        this.messages = spliceThreadHistory(this.messages, move.edits);
        return;
    }
  }

  take(): ThreadHistory {
    return [...this.messages];
  }
}
