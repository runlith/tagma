import { expect, test } from 'bun:test';
import { readInboxItem } from '@runlith/agent/thread/persisted';
import { Result } from 'effect';
import { ENTRY_KINDS } from '../composed.js';

const id = 'law-escaped:5:rule:commit';
const text = 'This raises law-escaped until it is gone.';
const current = 'This raises rule-escaped until it is gone.';

test('stored escape signals read in the current form without changing their journal identity or unrelated words', () => {
  const entry = { type: 'signal', id: `signal:${id}`, signalType: 'law-escaped', addressee: 'transport', text };
  const message = {
    role: 'user',
    metadata: { origin: 'envelope' },
    content: [{ type: 'text', text: `<law-escaped>${text}</law-escaped>` }],
  };
  const quoted = { role: 'user', content: [{ type: 'text', text: `<law-escaped>${text}</law-escaped>` }] };
  const payload = { entry, messages: [message, quoted], compacted: { keepFrom: 0, messages: [message] } };
  const formed = {
    entry: { ...entry, signalType: 'rule-escaped' },
    messages: [{ ...message, content: [{ type: 'text', text: `<rule-escaped>${current}</rule-escaped>` }] }, quoted],
    compacted: { keepFrom: 0, messages: [{ ...message, content: [{ type: 'text', text: `<rule-escaped>${current}</rule-escaped>` }] }] },
  };

  expect(ENTRY_KINDS.decode(entry)).toEqual(Result.succeed(formed.entry));
  expect(ENTRY_KINDS.formedEvent(payload)).toEqual(formed);
  expect(ENTRY_KINDS.formedEvent(formed)).toEqual(formed);
  expect(
    readInboxItem(ENTRY_KINDS, {
      id,
      threadId: 'holder',
      sender: { kind: 'host' },
      kind: 'signal',
      body: { type: 'law-escaped', addressee: 'transport', text },
      state: 'queued',
      deliveredToRunId: null,
      closedAt: null,
      closedBy: null,
      occurredAt: new Date(0),
      createdAt: new Date(0),
    }),
  ).toMatchObject({ id, kind: 'signal', body: { type: 'rule-escaped', text: current } });
});
