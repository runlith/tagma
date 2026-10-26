import { expect, test } from 'bun:test';
import { Message } from '@runlith/llm/schema/messages';
import { estimateThreadTokens, estimateThreadTokenSuffixes } from './measurement';

test('suffix estimates preserve array punctuation, rounding, images and binary payload weights', () => {
  const messages = [
    Message.user('a'),
    Message.assistant('bb'),
    Message.user([{ type: 'media', mediaType: 'image/png', data: new Uint8Array(3) }]),
    Message.assistant([{ type: 'reasoning', text: 'ccc', providerMetadata: { anthropic: { signature: 'unpriced' } } }]),
    Message.user([{ type: 'media', mediaType: 'application/pdf', data: new Uint8Array(5) }]),
    Message.assistant('dddd'),
  ];
  const suffix = estimateThreadTokenSuffixes(messages, 1600);
  expect(suffix).toEqual(messages.map((_, index) => estimateThreadTokens(messages.slice(index), 1600)).concat(estimateThreadTokens([])));
});

const readOf = (uri: string) => [
  Message.tool({
    id: 'call-1',
    name: 'read',
    result: {
      type: 'content',
      value: [
        { type: 'text', text: 'shot.png' },
        { type: 'file', uri, mime: 'image/png', name: 'shot.png', width: 1000, height: 750 },
      ],
    },
  }),
];

test('a picture a tool result holds is priced by its pixels, whether it rides as its location or as its bytes', () => {
  const stored = estimateThreadTokens(readOf('/api/threads/thread-1/attachments/shot.png'));
  const hydrated = estimateThreadTokens(readOf(`data:image/png;base64,${'A'.repeat(400_000)}`));

  expect(hydrated).toBe(stored);
  expect(stored).toBeGreaterThanOrEqual(1000);
  expect(stored).toBeLessThan(1100);
});
