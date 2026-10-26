import type { Message } from '@runlith/llm/schema/messages';

const ASSISTANT_TOKENS = 1_000;
const BYTES_PER_TOKEN = 4;

export type TailItem = {
  readonly type: 'message';
  readonly role: 'user' | 'assistant';
  readonly content: readonly { readonly type: 'input_text' | 'output_text'; readonly text: string }[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const continuation = (bytes: Uint8Array, at: number): boolean => at < bytes.length && ((bytes[at] ?? 0) & 0xc0) === 0x80;

const floorBoundary = (bytes: Uint8Array, at: number): number => {
  let index = Math.min(at, bytes.length);
  while (index > 0 && continuation(bytes, index)) index -= 1;
  return index;
};

const ceilBoundary = (bytes: Uint8Array, at: number): number => {
  let index = Math.max(at, 0);
  while (index < bytes.length && continuation(bytes, index)) index += 1;
  return index;
};

const tokensOf = (byteCount: number): number => Math.ceil(byteCount / BYTES_PER_TOKEN);

const truncated = (bytes: Uint8Array, tokens: number): string => {
  const budget = tokens * BYTES_PER_TOKEN;
  const left = Math.floor(budget / 2);
  const prefix = bytes.subarray(0, floorBoundary(bytes, left));
  const suffix = bytes.subarray(ceilBoundary(bytes, bytes.length - (budget - left)));
  return `${decoder.decode(prefix)}…${tokensOf(bytes.length - budget)} tokens truncated…${decoder.decode(suffix)}`;
};

const texts = (message: Message): readonly string[] =>
  message.content.flatMap((part) => (part.type === 'text' && part.deferredTools === undefined ? [part.text] : []));

const spoken = (message: Message): boolean => message.role === 'user' && texts(message).length > 0;

export const conversationTail = (messages: readonly Message[]): readonly TailItem[] => {
  const last = messages.findLastIndex(spoken);
  if (last < 0) return [];
  const previous = messages.findLastIndex((message, index) => index < last && spoken(message));
  let remaining = ASSISTANT_TOKENS;
  return messages.slice(previous < 0 ? last : previous, last + 1).flatMap((message): TailItem[] => {
    if (message.role === 'user') {
      const said = texts(message);
      return said.length === 0 ? [] : [{ type: 'message', role: 'user', content: said.map((text) => ({ type: 'input_text', text })) }];
    }
    if (message.role !== 'assistant') return [];
    const content = texts(message).flatMap((text) => {
      if (remaining === 0) return [];
      const bytes = encoder.encode(text);
      const tokens = tokensOf(bytes.length);
      if (tokens <= remaining) {
        remaining -= tokens;
        return [{ type: 'output_text' as const, text }];
      }
      const cut = truncated(bytes, remaining);
      remaining = 0;
      return [{ type: 'output_text' as const, text: cut }];
    });
    return content.length === 0 ? [] : [{ type: 'message', role: 'assistant', content }];
  });
};
