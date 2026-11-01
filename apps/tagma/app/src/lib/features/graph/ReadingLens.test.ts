import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import type { Tag } from '@tagma/server/graph/contract/wire/tags/declaration';
import type { ContractBindings } from '@tagma/server/graph/contract/wire/tags/behaviour';
import { ServedTags } from '@tagma/server/graph/contract/wire/tags/served';
import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';

import { testTagCatalog } from '$lib/app/testing.js';
import { ReadingLens, lensesFor } from './ReadingLens.svelte.js';

const served = (id: string, words: readonly [string, ...string[]], contracts: ContractBindings): Tag => ({
  id,
  fields: { status: { type: 'enum', values: [...words] }, holder: 'session' },
  edges: [],
  gates: [],
  roles: {},
  contracts,
  body: { shape: 'content' },
  prompt: '',
});

const task = served('task', ['open', 'in_work', 'done', 'closed'], {
  'core/lifecycle': { slots: { status: 'status' }, words: { initial: 'open', claimed: 'in_work', done: 'done', closed: 'closed' } },
  'core/work': { slots: {}, words: {} },
  'core/holder': { slots: { holder: 'holder' }, words: {} },
});

const spec = served('spec', ['open', 'closed'], {
  'core/lifecycle': { slots: { status: 'status' }, words: { initial: 'open', closed: 'closed' } },
  'core/spec': { slots: {}, words: {} },
});

const catalog = testTagCatalog();
catalog.table = new ServedTags({
  catalogs: [],
  installed: [],
  findings: [],
  tags: [task, spec],
  unreadable: [],
  actions: {},
  fieldNames: {},
  forms: {},
  laws: {},
  revision: { format: 2, revision: 'test' },
});

catalog.served = true;

const picked = (...names: string[]) => new Set(names);

const row = (over: Partial<TreeBlock> = {}): TreeBlock => ({
  name: 'aaaa1111',
  identity: over.name ?? 'aaaa1111',
  rowKey: 1,
  projectId: 1,
  parentName: 'root',
  parentIdentity: over.parentName === null ? null : (over.parentName ?? 'root'),
  ord: 0,
  tags: ['task'],
  fields: { status: 'open' },
  actions: { moves: [], slots: [], offers: [], revision: 'test' },
  title: 'A row',
  superseded: false,
  blocked: false,
  building: false,
  answered: false,
  deletedAt: null,
  createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '2026-09-05T00:00:00Z',
  ...over,
});

const lens = (frontier: readonly string[] = []) => new ReadingLens(new Set(frontier), catalog, makeStorage());

test('the lenses a tag selection offers are the states that tag really answers', () => {
  expect(lensesFor(catalog, picked())).toEqual(['open', 'in_work', 'ready', 'blocked', 'done', 'closed', 'superseded']);

  expect(lensesFor(catalog, picked('task'))).toEqual(['in_work', 'ready', 'blocked', 'done', 'closed', 'superseded']);

  expect(lensesFor(catalog, picked('spec'))).toEqual(['open', 'in_work', 'closed', 'superseded']);

  expect(lensesFor(catalog, picked('area'))).toEqual(['superseded']);
});

test('a ticked lens the tag selection stops offering is dropped rather than narrowing invisibly', () => {
  const reading = lens();
  reading.selectTag('task', true);
  reading.selectState('ready', true);
  expect(reading.matches(row({ name: 'on-frontier' }))).toBe(false);

  reading.selectTag('task', false);
  reading.selectTag('claim', true);
  expect([...reading.states]).toEqual([]);
  expect(reading.matches(row({ tags: ['claim'], fields: {} }))).toBe(true);
});

test('a row stands under the lens when its tag is among the tags and its state among the lenses', () => {
  const reading = lens(['on-frontier']);
  reading.selectTag('task', true);

  expect(reading.matches(row())).toBe(true);
  expect(reading.matches(row({ tags: ['claim'], fields: {} }))).toBe(false);
  expect(reading.matches(row({ tags: [], fields: {}, parentName: null }))).toBe(false);

  reading.selectState('ready', true);
  expect(reading.matches(row({ name: 'on-frontier' }))).toBe(true);
  expect(reading.matches(row({ name: 'waiting', blocked: true }))).toBe(false);

  expect(reading.matches(row({ name: 'on-frontier', tags: ['idea'] }))).toBe(false);

  reading.selectState('blocked', true);
  expect(reading.matches(row({ name: 'waiting', blocked: true }))).toBe(true);
});

test('a remembered tag filter outlives the moment before the vocabulary arrives, and drops only tags the served vocabulary lacks', () => {
  const storage = makeStorage();
  storage.setItem('lens', JSON.stringify({ tags: ['task', 'ghost'] }));
  const waiting = testTagCatalog();
  const early = new ReadingLens(new Set(), waiting, storage);
  early.restore('lens');
  expect([...early.tags]).toEqual(['task', 'ghost']);

  catalog.served = true;
  const late = new ReadingLens(new Set(), catalog, storage);
  late.restore('lens');
  expect([...late.tags]).toEqual(['task']);
});

test('state selections survive tag edits until a served vocabulary can judge them', () => {
  const waiting = testTagCatalog();
  const reading = new ReadingLens(new Set(), waiting, makeStorage());
  reading.selectState('ready', true);
  reading.selectState('in_work', true);
  reading.selectTag('task', true);
  reading.selectTag('spec', true);
  expect([...reading.states]).toEqual(['ready', 'in_work']);
  waiting.table = catalog.table;
  waiting.served = true;
  reading.selectTag('task', false);
  expect([...reading.states]).toEqual(['in_work']);
});

test('the building lens reads the building mark and the in-work status', () => {
  const building = lens();
  building.selectState('in_work', true);
  expect(building.matches(row({ tags: ['spec'], building: true }))).toBe(true);
  expect(building.matches(row({ tags: ['spec'] }))).toBe(false);
  expect(building.matches(row({ fields: { status: 'in_work' } }))).toBe(true);
});
