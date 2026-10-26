import { expect, test } from 'bun:test';
import { Result, Schema } from 'effect';
import { makeThreadEntryReader, type ThreadEntryReader, ThreadEntryUndecodable } from './kinds';

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

test('a kind declared twice is refused when the set is built', () => {
  expect(() => makeThreadEntryReader({ products: [{ type: 'message', schema: placed }] })).toThrow();
});
