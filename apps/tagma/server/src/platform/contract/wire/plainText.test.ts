import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { arms, knownAnswer } from './operation.js';
import { documentLines } from './plainText.js';
import { within } from '../service/presentation.js';

const answer = knownAnswer(
  arms({
    ok: { rows: Schema.Array(Schema.Struct({ id: Schema.String, done: Schema.Boolean })), next: Schema.NullOr(Schema.String) },
    gone: { reason: Schema.String, count: Schema.Number },
  }),
);

test('the generic voice reads an answer by its declared arm: success marker, nulls and empties dropped, false and 0 kept', () => {
  expect([...documentLines(answer, { status: 'ok', rows: [{ id: 'a1', done: false }], next: null })]).toEqual([
    'rows:',
    '  - id: a1',
    '    done: false',
  ]);
  expect([...documentLines(answer, { status: 'ok', rows: [], next: 'c2' })]).toEqual(['rows: none', 'next: c2']);
  expect([...documentLines(answer, { status: 'gone', reason: 'evicted', count: 0 })]).toEqual([
    'status: gone',
    'reason: evicted',
    'count: 0',
  ]);
});

test('a document past the budget stops at the budget without walking the rest', () => {
  let walked = 0;
  const rows = new Proxy(
    Array.from({ length: 100_000 }, (_, index) => ({ id: `row-${index}`, done: true })),
    {
      get: (target, key, receiver) => {
        if (typeof key === 'string' && /^\d+$/u.test(key)) walked += 1;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  const text = within(documentLines(answer, { status: 'ok', rows, next: null }), { bytes: 4_096, lines: 2_000 });
  expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(4_096);
  expect(text.split('\n').at(-1)).toContain('json');
  expect(walked).toBeLessThan(1_000);
});
