import { expect, test } from 'bun:test';
import { myersAlignment, OUTSIDE, stepsIn, type Sequence } from './sequenceDiff.js';

const sequence = (ids: readonly number[]): Sequence => ({
  length: ids.length,
  element: (at) => ids[at] ?? OUTSIDE,
  stronglyEqual: (left, right) => ids[left] === ids[right],
  boundaryScore: () => 0,
});

const run = (from: number, count: number): readonly number[] => Array.from({ length: count }, (_, at) => from + at);

test('a step budget bounds the comparisons an alignment makes, not only its rounds', () => {
  const rewritten = myersAlignment(sequence(run(0, 3000)), sequence(run(10_000, 3000)), stepsIn(100_000));
  expect(rewritten.timedOut).toBe(true);

  const long = run(0, 10_000);
  const edited = long.map((id, at) => (at === 5000 ? -2 : id));
  const local = myersAlignment(sequence(long), sequence(edited), stepsIn(100_000));
  expect(local).toEqual({ changes: [{ before: { start: 5000, end: 5001 }, after: { start: 5000, end: 5001 } }], timedOut: false });
});

test('the finishing snake is charged to a budget the next alignment shares', () => {
  const long = run(0, 10_000);
  const head = long.map((id, at) => (at === 0 ? -2 : id));
  const shared = stepsIn(15_000);
  const aligned = () => myersAlignment(sequence(long), sequence(head), shared).timedOut;
  expect([aligned(), aligned(), aligned()]).toEqual([false, false, true]);
});
