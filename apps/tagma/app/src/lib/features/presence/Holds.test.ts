import { expect, test } from 'vitest';
import { Holds } from './Holds.js';

test('holders of one key share one value; the last release closes it and a later take opens a fresh one', () => {
  const closed: number[] = [];
  let opened = 0;
  const holds = new Holds<number>((value) => closed.push(value));
  const first = holds.take('set', () => (opened += 1));
  const second = holds.take('set', () => (opened += 1));
  const other = holds.take('other', () => (opened += 1));
  expect([first.value, second.value, other.value]).toEqual([1, 1, 2]);
  first.release();
  first.release();
  expect(closed).toEqual([]);
  second.release();
  expect(closed).toEqual([1]);
  expect(holds.take('set', () => (opened += 1)).value).toBe(3);
});
