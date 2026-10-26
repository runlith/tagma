import { expect, test } from 'bun:test';
import type { ModuleCard } from '../../graph/contract/wire/modules.js';
import { assembleMap } from './moduleMap.js';

const card = (block: number, fields: Partial<ModuleCard>): ModuleCard => ({
  block,
  name: `0000000${block}`,
  title: `card ${block}`,
  parent: null,
  placedUnder: null,
  id: undefined,
  roots: [],
  cuts: [],
  entries: undefined,
  order: undefined,
  imports: [],
  importsTests: [],
  unreadable: undefined,
  ...fields,
});

test('the map holds the leaf modules with paths from the repository root, a parent widening only the region', () => {
  const reading = assembleMap([
    card(1, { roots: ['srv'] }),
    card(2, {
      parent: 1,
      id: 'graph',
      roots: ['srv/graph'],
      entries: [{ at: 'contract/wire/' }, { at: '.', for: ['00000003'], role: 'port' }],
      order: [['contract/wire/'], ['.']],
    }),
    card(3, { parent: 1, id: 'shell', roots: ['srv/shell'], cuts: ['srv/graph/drill.itest.ts'], imports: [2], importsTests: [4] }),
    card(4, { id: 'kit', roots: ['kit'] }),
  ]);
  expect(reading.problems).toEqual([]);
  expect(reading.map).toEqual({
    modules: [
      {
        id: 'graph',
        territory: ['srv/graph/'],
        entries: [{ at: 'srv/graph/contract/wire/' }, { at: 'srv/graph/', for: ['shell'], role: 'port' }],
        order: [['srv/graph/contract/wire/'], ['srv/graph/']],
      },
      { id: 'shell', territory: ['srv/shell/', 'srv/graph/drill.itest.ts'], entries: [] },
      { id: 'kit', territory: ['kit/'], entries: [] },
    ],
    relations: [
      { from: 'shell', to: 'graph' },
      { from: 'shell', to: 'kit', role: 'testing' },
    ],
    region: ['kit/', 'srv/', 'srv/graph/', 'srv/graph/drill.itest.ts', 'srv/shell/'],
  });
});

test('a module holding modules carries no relation, entry, order or cut, and a relation or a `for` naming it is a problem', () => {
  const { problems } = assembleMap([
    card(1, { roots: ['srv'], imports: [3], entries: [{ at: 'a/' }] }),
    card(2, { parent: 1, id: 'graph', roots: ['srv/graph'], imports: [1], entries: [{ at: '.', for: ['00000001'] }] }),
    card(3, { id: 'kit', roots: ['kit'] }),
  ]);
  expect(problems).toHaveLength(3);
  expect(problems[0]).toContain('relations, entries');
  expect(problems.slice(1).every((one) => one.includes('holds modules'))).toBe(true);
});

test('a leaf without an id or with two roots, and a relation carried both ways, are problems', () => {
  const { problems } = assembleMap([
    card(1, { roots: ['a'] }),
    card(2, { id: 'b', roots: ['b', 'bb'] }),
    card(3, { id: 'c', roots: ['c'], imports: [2], importsTests: [2] }),
  ]);
  expect(problems).toHaveLength(3);
});
