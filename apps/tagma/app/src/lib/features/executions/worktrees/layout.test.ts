import { expect, test } from 'vitest';
import { paneNode, splitNode } from '../terminal/paneLayout.js';
import { parseStoredLayout, parseStoredWorktrees, planAdopt, pruneStoredTree, serializeTab, type StoredLayout } from './layout.js';

test('planning births stored groups once in stored order, and prunes leaves the roster lost', () => {
  const stored: StoredLayout = {
    order: ['t:0', 'solo:0'],
    tabs: {
      't:0': { title: null, tree: splitNode('row', paneNode('t:0'), paneNode('gone:0')), labels: {}, active: null, holder: null },
    },
    closed: [],
    shown: false,
    active: null,
  };
  expect(planAdopt(['solo:0', 't:0', 'u:0'], stored)).toEqual([
    { key: 't:0', leaves: ['t:0'] },
    { key: 'solo:0', leaves: ['solo:0'] },
    { key: 'u:0', leaves: ['u:0'] },
  ]);
  expect(planAdopt(['b:0', 'a:0'], null)).toEqual([
    { key: 'b:0', leaves: ['b:0'] },
    { key: 'a:0', leaves: ['a:0'] },
  ]);
  const pruned = pruneStoredTree(stored.tabs['t:0']!.tree, new Set(['t:0']));
  expect(pruned).toEqual(paneNode('t:0'));
  expect(pruneStoredTree(stored.tabs['t:0']!.tree, new Set())).toBe(null);
  expect(
    serializeTab(
      splitNode('row', paneNode('p1'), paneNode('p2')),
      (pane) => (pane === 'p1' ? 'e1:0' : null),
      () => null,
      't',
      'p1',
      null,
    ),
  ).toEqual({ title: 't', tree: paneNode('e1:0'), labels: {}, active: 'e1:0', holder: null });
});

test('a place’s active tab and each tab’s active pane survive the stored round trip; a value without them reads with nothing active', () => {
  const place = {
    order: ['t:0', 'solo:0'],
    tabs: {
      't:0': { title: null, tree: splitNode('row', paneNode('t:0'), paneNode('u:0')), labels: {}, active: 'u:0' },
      'solo:0': { title: null, tree: paneNode('solo:0'), labels: {}, active: 'elsewhere:0' },
    },
    closed: [],
    active: 't:0',
  };
  const read = parseStoredWorktrees(JSON.parse(JSON.stringify({ places: { root: place } }))).get('root');
  expect(read?.active).toBe('t:0');
  expect(read?.tabs['t:0']?.active).toBe('u:0');
  expect(read?.tabs['solo:0']?.active).toBe(null);

  const old = parseStoredLayout({ order: ['a:0'], tabs: { 'a:0': { title: null, tree: paneNode('a:0'), labels: {} } }, closed: [] });
  expect(old?.active).toBe(null);
  expect(old?.tabs['a:0']?.active).toBe(null);
});

test('a stored layout that no longer decodes is dropped tab by tab and place by place', () => {
  expect(parseStoredLayout({ order: ['a'], tabs: { a: { title: '', tree: { kind: 'pane' }, labels: [] } } })).toEqual({
    order: ['a'],
    tabs: {},
    closed: [],
    shown: false,
    active: null,
  });
  expect(parseStoredLayout({ order: 'a', tabs: {} })).toBe(null);
  expect(parseStoredLayout(null)).toBe(null);

  const places = parseStoredWorktrees({
    places: {
      kept: { order: ['a:0'], tabs: { 'a:0': { title: null, tree: paneNode('a:0'), labels: {} } }, closed: [] },
      broken: { order: 7, tabs: {} },
    },
  });
  expect([...places.keys()]).toEqual(['kept']);
  expect(parseStoredWorktrees({ order: [], tabs: {}, closed: [] }).size).toBe(0);
});
