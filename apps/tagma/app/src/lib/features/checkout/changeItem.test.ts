import { expect, test } from 'vitest';
import { shownOrder, stepOf } from './changeItem.js';

const paths = (...names: string[]) => names.map((path) => ({ path }));

test('stepping walks the order on screen: folder groups gather a re-met directory before the next one', () => {
  const items = paths('src/b.ts', 'README.md', 'src/a.ts');

  expect(shownOrder(items, false).map((one) => one.path)).toEqual(['src/b.ts', 'README.md', 'src/a.ts']);
  expect(shownOrder(items, true).map((one) => one.path)).toEqual(['src/b.ts', 'src/a.ts', 'README.md']);
});

test('a step moves one row, stops at the ends, and a path not in the list enters at the near end', () => {
  const items = paths('a', 'b', 'c');

  expect(stepOf(items, 'b', 1)?.path).toBe('c');
  expect(stepOf(items, 'b', -1)?.path).toBe('a');
  expect(stepOf(items, 'c', 1)).toBeNull();
  expect(stepOf(items, 'elsewhere', 1)?.path).toBe('a');
  expect(stepOf(items, 'elsewhere', -1)?.path).toBe('c');
});
