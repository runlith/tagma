import { expect, test } from 'bun:test';
import { softwareDevelopment } from '../../../../catalogs/contract/wire/softwareDevelopment.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { mapLines, mapNodes, mapRegions, regionAbove, type MapNode, type MapRow } from '../../../../graph/orientation/map.js';
import { BEHAVIOUR_REGISTRY } from '../../composed.js';

const table = new TagIndex([...softwareDevelopment.tags], BEHAVIOUR_REGISTRY);

const node = (id: number, parentId: number | null, title: string, over: Partial<MapNode> = {}): MapNode => ({
  id,
  uuid: `00000000-0000-7000-8000-00000000${String(id).padStart(4, '0')}`,
  parentId,
  ord: id,
  title,
  kind: null,
  places: [],
  ...over,
});

const row = (id: number, parentId: number | null, title: string, over: Partial<MapRow> = {}): MapRow => ({
  id,
  uuid: `00000000-0000-7000-8000-00000000${String(id).padStart(4, '0')}`,
  parentId,
  ord: id,
  tags: ['module'],
  title,
  superseded: 0,
  ...over,
});

const nodes = [
  node(1, null, 'out', { places: ['src/outside'] }),
  node(2, null, 'branch', { places: ['src/branch'] }),
  node(3, 2, 'middle', { places: ['src/branch/middle'] }),
  node(4, 3, 'leaf', { places: ['src/branch/middle/leaf'] }),
];

const ids = (lines: readonly string[]) => lines.map((line) => /- ([0-9a-f]{8})\b/u.exec(line)?.[1]);

test('map cuts preserve breadth priority and prefer a focused branch within the same budget', () => {
  const whole = mapLines(nodes, Infinity);
  expect(ids(whole.lines)).toEqual(['00000001', '00000002', '00000003', '00000004']);
  expect(whole.left).toBe(0);
  expect(mapLines(nodes, 0)).toEqual({ lines: [], left: nodes.length });

  const budget = mapLines(nodes.slice(1), Infinity).lines.join('\n').length;
  const blind = mapLines(nodes, budget);
  expect(blind.lines.join('\n').length).toBeLessThanOrEqual(budget);
  expect(ids(blind.lines)).toEqual(['00000001', '00000002', '00000003']);
  expect(blind.left).toBe(1);
  expect(/\(\+(\d+)\)$/u.exec(blind.lines[2]!)?.[1]).toBe('1');

  const focused = mapLines(nodes.slice(1), Infinity, 3).lines.join('\n').length;
  const aimed = mapLines(nodes, focused, 3);
  expect(aimed.lines.join('\n').length).toBeLessThanOrEqual(focused);
  expect(ids(aimed.lines)).toEqual(['00000002', '00000003', '00000004']);
  expect(aimed.left).toBe(1);
});

test('a map exposes paths only along its focused branch', () => {
  const names = mapLines(nodes, Infinity);
  expect(ids(names.lines)).toEqual(['00000001', '00000002', '00000003', '00000004']);
  for (const path of nodes.flatMap((one) => one.places)) expect(names.lines.join('\n')).not.toContain(path);
  const aimed = mapLines(nodes, Infinity, 3).lines.join('\n');
  expect(aimed).not.toContain('src/outside');
  for (const path of nodes.slice(1).flatMap((one) => one.places)) expect(aimed).toContain(path);
});

test('mapNodes projects kind and sources under the nearest standing container or the page holding it', () => {
  const rows = [
    row(1, null, 'Substrate'),
    row(2, 1, 'A decision about the substrate', { tags: ['spec'] }),
    row(3, 2, 'Executions'),
    row(4, 1, 'The old shape', { superseded: 1 }),
    row(5, 4, 'Git'),
    row(6, null, 'Agents', { tags: [] }),
    row(7, 6, 'Threads'),
    row(8, null, 'Notes', { tags: [] }),
  ];
  const projected = mapNodes(
    rows,
    mapRegions(table, rows, 9),
    9,
    new Map([
      [1, ['packages/git', 'packages/git-cut.ts']],
      [3, ['packages/executions']],
    ]),
    new Map([[1, 'kit']]),
  );
  expect(projected.map((one) => [one.id, one.parentId, one.kind, one.places])).toEqual([
    [1, null, 'kit', ['packages/git', 'packages/git-cut.ts']],
    [3, 1, null, ['packages/executions']],
    [5, 1, null, []],
    [6, null, null, []],
    [7, 6, null, []],
  ]);
});

test('cyclic ancestry is counted as omitted while the reachable root is drawn', () => {
  const cyclic = [
    node(1, 2, 'first', { places: ['src/first'] }),
    node(2, 1, 'second', { places: ['src/second'] }),
    node(3, null, 'standing', { places: ['src/standing'] }),
  ];
  for (const aim of [undefined, 1]) {
    const drawn = mapLines(cyclic, Infinity, aim);
    expect(ids(drawn.lines)).toEqual(['00000003']);
    expect(drawn.left).toBe(2);
  }
});

test('a reading aimed at a task opens the region that task stands in', () => {
  const rows = [
    row(1, null, 'Substrate'),
    row(2, 1, 'Executions'),
    row(3, 2, 'A decision', { tags: ['spec'] }),
    row(4, 3, 'carve', { tags: ['task'] }),
    row(5, null, 'the old shape', { superseded: 1 }),
    row(6, 5, 'grind', { tags: ['task'] }),
  ];
  const above = (all: readonly MapRow[], blockId: number | null) =>
    regionAbove(all, mapNodes(all, mapRegions(table, all, 9), 9, new Map()), 9, blockId);
  expect(above(rows, 4)).toBe(2);
  expect(above(rows, 2)).toBe(2);
  expect(above(rows, 6)).toBeUndefined();
  expect(above(rows, null)).toBeUndefined();
  expect(above([...rows, row(9, null, 'the project', { tags: [] })], 9)).toBeUndefined();
  expect(above([row(7, 8, 'a', { tags: ['task'] }), row(8, 7, 'b', { tags: ['task'] })], 7)).toBeUndefined();
});
