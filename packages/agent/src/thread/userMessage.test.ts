import { expect, test } from 'bun:test';
import { threadSignalEvent, threadUserMessageEvent } from './events';

const run = { id: 'run-1' } as Parameters<typeof threadUserMessageEvent>[0];

const attachments = [
  { id: 'a.md', mediaType: 'text/markdown', url: '/api/threads/t/attachments/a.md', filename: 'Call', text: '# Call\n\nMe: ship it' },
  { id: 'b.png', mediaType: 'image/png', url: '/api/threads/t/attachments/b.png' },
] as const;

test('a document attachment enters the model message as text and a picture as media, so context upkeep sees the words', () => {
  const event = threadUserMessageEvent(run, { text: 'what did they decide?', reader: true, attachments });

  const content = event.kind === 'message' ? (event.payload.messages?.[0]?.content ?? []) : [];
  expect(content.map((part) => part.type)).toEqual(['text', 'text', 'media']);
  expect(content[1]).toEqual({ type: 'text', text: 'Attached document:\n\n# Call\n\nMe: ship it' });
});

test('words steered into a running turn carry their document as text too, never as a media part no wire lowers', () => {
  const event = threadSignalEvent(
    { id: 's1', type: 'user-message', addressee: 'reader', text: 'and this', occurredAt: '2026-10-07T12:00:00.000Z' },
    'run-1',
    { attachments },
  );

  const content = event.payload.messages?.[0]?.content ?? [];
  expect(content.map((part) => part.type)).toEqual(['text', 'text', 'media']);
  expect(content[1]).toEqual({ type: 'text', text: 'Attached document:\n\n# Call\n\nMe: ship it' });
});
