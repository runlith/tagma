import { expect, test } from 'bun:test';
import { Details } from './details.js';
import { packVerdict } from '../lines/packed.js';
import { summarize } from '../lines/projection.js';

test('a verdict budget evicts the least recently read detail and leaves an oversized verdict uncached', () => {
  const packed = packVerdict(summarize([], [], null, new Map()), 1 << 20)!;
  const measure = new Details(1 << 20);
  measure.keep('a', 'print', packed);
  const details = new Details(measure.retained * 2);
  details.keep('a', 'print', packed);
  details.keep('b', 'print', packed);
  expect(details.read('a', 'print')).toBe(packed);
  details.keep('c', 'print', packed);
  expect(details.read('b', 'print')).toBeUndefined();
  expect(details.read('a', 'old')).toBeUndefined();
  expect(details.read('a', 'print')).toBe(packed);
  expect(details.read('c', 'print')).toBe(packed);
  expect(details.retained).toBeLessThanOrEqual(details.limit);
  details.keep('a', 'print', { ...packed, bytes: details.limit + 1 });
  expect(details.read('a', 'print')).toBeUndefined();
  expect(details.read('c', 'print')).toBe(packed);
  details.forget('c');
  expect(details.retained).toBe(0);
});
