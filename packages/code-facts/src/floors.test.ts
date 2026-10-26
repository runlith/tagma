import { describe, expect, it } from 'bun:test';
import { floorCrossings } from './floors';
import { createImportClosure, type ImportEdge, updateImportClosure } from './imports';

const floors = [['core/'], ['core/ui/'], ['planeA/', 'planeB/']];
const edges = [
  { file: 'core/model.ts', line: 1, specifier: './ui/panel', to: 'core/ui/panel.ts' },
  { file: 'core/ui/panel.ts', line: 2, specifier: '../model', to: 'core/model.ts' },
  { file: 'planeA/index.ts', line: 3, specifier: '../planeB/index', to: 'planeB/index.ts' },
  { file: 'planeA/index.ts', line: 4, specifier: './own', to: 'planeA/own.ts' },
  { file: 'loose.ts', line: 5, specifier: './planeB/index', to: 'planeB/index.ts' },
  { file: 'planeB/index.ts', line: 6, specifier: '../loose', to: 'loose.ts' },
];

describe('floorCrossings', () => {
  it('answers upward edges and sibling edges, with the longest entry deciding where a file stands', () => {
    expect(floorCrossings(edges, floors, 'cross')).toEqual([
      { from: 'core/', to: 'core/ui/', file: 'core/model.ts', line: 1, specifier: './ui/panel' },
      { from: 'planeA/', to: 'planeB/', file: 'planeA/index.ts', line: 3, specifier: '../planeB/index' },
    ]);
  });

  it('lets entries of one floor reach each other when siblings are allowed', () => {
    expect(floorCrossings(edges, floors, 'allow')).toEqual([
      { from: 'core/', to: 'core/ui/', file: 'core/model.ts', line: 1, specifier: './ui/panel' },
    ]);
  });
});

const links = (pairs: readonly (readonly [string, string])[]): ImportEdge[] =>
  pairs.map(([file, to]) => ({ file, line: 1, specifier: to, to }));

const sortedReached = (reached: ReadonlySet<string>): readonly string[] => [...reached].sort();

describe('import closure', () => {
  it('reaches the root and its transitive targets alone, leaving unreached islands out', () => {
    const closure = createImportClosure(
      'root',
      links([
        ['root', 'a'],
        ['a', 'b'],
        ['x', 'y'],
      ]),
    );
    expect(sortedReached(closure.reached)).toEqual(['a', 'b', 'root']);
  });

  it('drops only what a removed edge reached, and a whole cycle once its entry falls', () => {
    const closure = createImportClosure(
      'root',
      links([
        ['root', 'a'],
        ['a', 'b'],
        ['b', 'a'],
        ['b', 'c'],
      ]),
    );
    const pruned = updateImportClosure(closure, new Map([['b', ['a']]]));
    expect(pruned.added).toEqual([]);
    expect(pruned.removed).toEqual(['c']);
    expect(sortedReached(closure.reached)).toEqual(['a', 'b', 'root']);
    const felled = updateImportClosure(closure, new Map([['root', []]]));
    expect(felled.added).toEqual([]);
    expect(felled.removed).toEqual(['a', 'b']);
    expect(sortedReached(closure.reached)).toEqual(['root']);
  });

  it('keeps a shared child through its alternate parent when one edge is removed', () => {
    const closure = createImportClosure(
      'root',
      links([
        ['root', 'a'],
        ['root', 'b'],
        ['a', 'c'],
        ['b', 'c'],
      ]),
    );
    const kept = updateImportClosure(closure, new Map([['a', []]]));
    expect(kept.added).toEqual([]);
    expect(kept.removed).toEqual([]);
    expect(sortedReached(closure.reached)).toEqual(['a', 'b', 'c', 'root']);
  });

  it('moves nothing when the touched path was never reached', () => {
    const closure = createImportClosure(
      'root',
      links([
        ['root', 'a'],
        ['x', 'y'],
      ]),
    );
    const moved = updateImportClosure(closure, new Map([['x', ['z']]]));
    expect(moved.added).toEqual([]);
    expect(moved.removed).toEqual([]);
    expect(sortedReached(closure.reached)).toEqual(['a', 'root']);
  });

  it('grafts new subtrees reported beside the edge that reaches them', () => {
    const closure = createImportClosure('root', links([['root', 'a']]));
    const grafted = updateImportClosure(
      closure,
      new Map([
        ['root', ['a', 'n']],
        ['n', ['m']],
        ['m', []],
      ]),
    );
    expect(grafted.added).toEqual(['m', 'n']);
    expect(grafted.removed).toEqual([]);
    expect(sortedReached(closure.reached)).toEqual(['a', 'm', 'n', 'root']);
  });

  it('answers the same reached set on identical edges, without walking the graph', () => {
    const closure = createImportClosure(
      'root',
      links([
        ['root', 'a'],
        ['a', 'b'],
        ['x', 'y'],
      ]),
    );
    const before = closure.reached;
    const same = updateImportClosure(
      closure,
      new Map([
        ['a', ['b']],
        ['x', ['y']],
      ]),
    );
    expect(same.reached).toBe(before);
    expect(same.added).toEqual([]);
    expect(same.removed).toEqual([]);
  });
});
