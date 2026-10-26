import { expect, test } from 'vitest';
import { treeLines, treeStep } from './treeLines.js';

const shape: Record<string, readonly string[]> = { root: ['a', 'b'], a: ['a1', 'a2'], a1: ['deep'] };
const children = (name: string): readonly string[] => shape[name] ?? [];

test('only expanded branches show their children', () => {
  expect(treeLines('root', children, new Set()).map((line) => line.name)).toEqual(['a', 'b']);
  expect(treeLines('root', children, new Set(['a'])).map((line) => [line.name, line.depth, line.branch])).toEqual([
    ['a', 1, true],
    ['a1', 2, true],
    ['a2', 2, false],
    ['b', 1, false],
  ]);
});

test('arrows expand, descend, collapse and climb the visible tree', () => {
  const closed = new Set<string>();
  expect(treeStep(treeLines('root', children, closed), 'a', 'ArrowRight', closed)).toEqual({ kind: 'expand', name: 'a' });

  const open = new Set(['a']);
  const lines = treeLines('root', children, open);
  expect(treeStep(lines, 'a', 'ArrowRight', open)).toEqual({ kind: 'focus', name: 'a1' });
  expect(treeStep(lines, 'a2', 'ArrowLeft', open)).toEqual({ kind: 'focus', name: 'a' });
  expect(treeStep(lines, 'a', 'ArrowLeft', open)).toEqual({ kind: 'collapse', name: 'a' });
  expect(treeStep(lines, 'b', 'ArrowLeft', open)).toBeNull();
  expect(treeStep(lines, 'a2', 'ArrowDown', open)).toEqual({ kind: 'focus', name: 'b' });
  expect(treeStep(lines, 'a', 'End', open)).toEqual({ kind: 'focus', name: 'b' });
});
