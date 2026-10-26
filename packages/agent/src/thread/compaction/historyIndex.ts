import type { MediaPart, Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { opensTurnMessage } from '../../agent/AgentSignal';
import { agentToolOutputText } from '../../agent/ToolOutput';
import { isPicturePart } from './media';
import { estimateImagePartTokens, estimateThreadTokens } from './measurement';

export type IndexedResult = { readonly index: number; readonly part: ToolResultPart; readonly tokens: number };

export type IndexedMedia =
  | { readonly kind: 'picture'; readonly index: number; readonly user: boolean; readonly data: MediaPart['data'] }
  | {
      readonly kind: 'files';
      readonly index: number;
      readonly part: ToolResultPart;
      readonly uris: readonly string[];
      readonly tokens: number;
    };

export function resultTokens(result: ToolResultPart['result']): number {
  const text = estimateThreadTokens(agentToolOutputText(result));
  if (result.type !== 'content') return text;
  let pictures = 0;
  for (const part of result.value) pictures += estimateImagePartTokens(part);
  return text + pictures;
}

export class HistoryIndex {
  private covered: readonly Message[] = [];
  private readonly turns: number[] = [];
  private lastAnswer = -1;
  private readonly open: IndexedResult[] = [];
  private readonly held: IndexedMedia[] = [];

  private constructor(private readonly clearedOutput: string) {}

  static of(messages: readonly Message[], clearedOutput: string): HistoryIndex {
    return new HistoryIndex(clearedOutput).extend(messages, 0);
  }

  get messages(): readonly Message[] {
    return this.covered;
  }

  get openings(): readonly number[] {
    return this.turns;
  }

  get answered(): number {
    return this.lastAnswer;
  }

  get results(): readonly IndexedResult[] {
    return this.open;
  }

  get media(): readonly IndexedMedia[] {
    return this.held;
  }

  over(messages: readonly Message[]): HistoryIndex {
    if (messages === this.covered) return this;
    const known = this.covered;
    if (messages.length < known.length) return HistoryIndex.of(messages, this.clearedOutput);
    for (let at = 0; at < known.length; at += 1) if (messages[at] !== known[at]) return HistoryIndex.of(messages, this.clearedOutput);
    return this.extend(messages, known.length);
  }

  private extend(messages: readonly Message[], from: number): HistoryIndex {
    for (let index = from; index < messages.length; index += 1) {
      const message = messages[index]!;
      if (opensTurnMessage(message)) this.turns.push(index);
      if (message.role === 'assistant') this.lastAnswer = index;
      for (const part of message.content) {
        if (isPicturePart(part)) this.held.push({ kind: 'picture', index, user: message.role === 'user', data: part.data });
        if (part.type !== 'tool-result') continue;
        const open = (message.role === 'tool' || message.role === 'assistant') && !this.reads(part);
        const uris = part.result.type !== 'content' ? [] : part.result.value.flatMap((item) => (item.type === 'file' ? [item.uri] : []));
        if (!open && uris.length === 0) continue;
        const tokens = resultTokens(part.result);
        if (open) this.open.push({ index, part, tokens });
        if (uris.length > 0) this.held.push({ kind: 'files', index, part, uris, tokens });
      }
    }
    this.covered = messages;
    return this;
  }

  private reads(part: ToolResultPart): boolean {
    return part.result.type === 'text' && part.result.value === this.clearedOutput;
  }
}
