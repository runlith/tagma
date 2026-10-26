import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { subjectFields } from './subjects.js';
import { ThreadId } from './thread.js';

test('a subject field is respelled along its path, in lists and nested records, and nothing else changes', () => {
  const schema = Schema.Struct({
    threadId: ThreadId,
    at: Schema.Array(Schema.Struct({ threadId: ThreadId, entry: Schema.String })),
    note: Schema.String,
  });
  const input = {
    threadId: 'lead',
    at: [
      { threadId: 'scribe', entry: 'first' },
      { threadId: 'lead', entry: 'second' },
    ],
    note: 'lead',
  };
  const ids: Readonly<Record<string, string>> = { lead: 'id-lead', scribe: 'id-scribe' };
  const body = subjectFields(schema).reduce<unknown>((value, field) => field.respelled(value, (name) => ids[name] ?? name), input);
  expect(body).toEqual({
    threadId: 'id-lead',
    at: [
      { threadId: 'id-scribe', entry: 'first' },
      { threadId: 'id-lead', entry: 'second' },
    ],
    note: 'lead',
  });
  expect(input.at[0]?.threadId).toBe('scribe');
});
