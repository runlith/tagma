import { expect, test } from 'bun:test';
import { JournalPayloadUnreadable, readJournal } from './journalPayloads.js';

const stored = (op: string, payload: unknown) => ({
  id: 41,
  op,
  payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
});

test('a stored payload decodes into its typed shape and ignores keys its reader does not know', () => {
  const read = readJournal.update(
    stored('update', { chars: 9, wasChars: 4, delta: [{ at: 0, del: 'a', ins: 'b' }], status: undefined, extra: 1 }),
  );
  expect(read._tag).toBe('Success');
  if (read._tag === 'Success') expect(read.success.delta).toEqual([{ at: 0, del: 'a', ins: 'b' }]);
});

test('a payload that is not JSON or carries a field of the wrong type is a typed failure naming the event', () => {
  for (const payload of ['{"chars":"many"', { chars: 'many' }, { delta: [{ at: 'x' }] }]) {
    const read = readJournal.update(stored('update', payload));
    expect(read._tag).toBe('Failure');
    if (read._tag === 'Failure') {
      expect(read.failure).toBeInstanceOf(JournalPayloadUnreadable);
      expect(read.failure.eventId).toBe(41);
      expect(read.failure.op).toBe('update');
    }
  }
});

test('a link written before links recorded their target reads as a link with no known target, and a target of the wrong type does not decode', () => {
  const bare = readJournal.link(stored('link', { kind: 'relates' }));
  expect(bare._tag === 'Success' && bare.success).toEqual({ kind: 'relates' });
  expect(readJournal.link(stored('link', { kind: 'relates', toId: 'b' }))._tag).toBe('Failure');
  expect(readJournal.trash(stored('delete', { ids: [3, 4] }))._tag).toBe('Success');
});
