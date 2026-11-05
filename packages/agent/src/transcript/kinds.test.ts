import { expect, test } from 'bun:test';
import { Result, Schema } from 'effect';
import { markThreadEntry } from './eventFold';
import { makeThreadEntryReader, type ThreadEntryReader, ThreadEntryUndecodable, ThreadEntryUnreadable } from './kinds';
import type { ThreadTranscriptEntry } from './rows';

const placed = Schema.Struct({ type: Schema.tag('placed'), id: Schema.String, rootId: Schema.String });

const failureOf = (read: ReturnType<ThreadEntryReader['decode']>) => (Result.isFailure(read) ? read.failure : null);
const successOf = (read: ReturnType<ThreadEntryReader['decode']>): unknown => (Result.isSuccess(read) ? read.success : null);

test('an entry of a kind nobody installed is a typed error naming it, and the installed product kind decodes to its member', () => {
  const core = makeThreadEntryReader({ products: [] });
  const products = makeThreadEntryReader({ products: [{ type: 'placed', schema: placed }] });
  const entry = { type: 'placed', id: 'placed:1', rootId: 'root-1' };

  const unknown = failureOf(core.decode(entry));
  expect(unknown).toBeInstanceOf(ThreadEntryUndecodable);
  expect(unknown).toMatchObject({ type: 'placed', id: 'placed:1' });
  expect(successOf(products.decode(entry))).toEqual(entry);
  expect(failureOf(products.decode({ ...entry, rootId: 7 }))).toBeInstanceOf(ThreadEntryUndecodable);
});

test('a core entry is closed over its schema: a field it does not declare is refused, not carried', () => {
  const kinds = makeThreadEntryReader({ products: [] });
  const said = { type: 'message', id: 'm1', role: 'user', text: 'hi' };
  expect(successOf(kinds.decode(said))).toEqual(said);
  expect(failureOf(kinds.decode({ ...said, mood: 'calm' }))?.type).toBe('message');
});

test('a stored entry no kind reads stays a line, and what a writer stores is the record it stood on, its mark included', () => {
  const core = makeThreadEntryReader({ products: [] });
  const body = { type: 'placed', id: 'placed:1', runId: 'run', occurredAt: 'then', rootId: 'root-1' };
  const read = successOf(core.stored(body)) as ThreadTranscriptEntry;

  expect(ThreadEntryUnreadable.is(read)).toBe(true);
  expect(read).toMatchObject({ id: 'placed:1', runId: 'run', occurredAt: 'then', refusal: { type: 'placed' } });
  expect(JSON.parse(JSON.stringify(read))).toEqual(body);

  const mark = { by: 'rewind', scope: 'from' } as const;
  const marked = markThreadEntry(read, mark);
  expect(ThreadEntryUnreadable.is(marked)).toBe(true);
  expect(JSON.parse(JSON.stringify(marked))).toEqual({ ...body, rewound: mark });
  expect(JSON.parse(JSON.stringify(markThreadEntry(marked, null)))).toEqual(body);

  const strange = { ...body, rewound: { by: 'a later build', scope: 'elsewhere' } };
  expect(JSON.parse(JSON.stringify(successOf(core.stored(strange))))).toEqual(strange);

  const installed = makeThreadEntryReader({ products: [{ type: 'placed', schema: placed }] });
  expect(successOf(installed.stored({ type: 'placed', id: 'placed:1', rootId: 'root-1' }))).toEqual({
    type: 'placed',
    id: 'placed:1',
    rootId: 'root-1',
  });
  expect(failureOf(core.stored({ type: 'placed' }))).toBeInstanceOf(ThreadEntryUndecodable);
});

test('a kind declared twice is refused when the set is built', () => {
  expect(() => makeThreadEntryReader({ products: [{ type: 'message', schema: placed }] })).toThrow();
});
