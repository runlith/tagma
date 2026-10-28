import type { Tag } from '@tagma/server/graph/contract/wire/tags/declaration';
import type { TagActions } from '@tagma/server/graph/contract/wire/tags/actions';
import type { Vocabulary } from '@tagma/server/graph/contract/wire/tags/table';
import { ServedTags } from '@tagma/server/graph/contract/wire/tags/served';
import { expect, test } from 'vitest';

import { testTagCatalog } from '$lib/app/testing.js';
import type { StatusAction } from './status.js';
import type { MarkedRow } from './TagCatalog.svelte.js';

const act = (action: StatusAction): string => action.op ?? `set:${action.to}`;

const shipment: Tag = {
  id: 'shipment',
  fields: { status: { type: 'enum', values: ['open', 'review', 'shipped', 'dropped'] } },
  edges: ['relates'],
  gates: [
    { gate: 'transition', field: 'status', from: 'open', to: 'review' },
    { gate: 'transition', field: 'status', from: 'review', to: 'shipped' },
    { gate: 'transition', field: 'status', from: 'review', to: 'dropped' },
  ],
  roles: {},
  contracts: {
    'core/lifecycle': { slots: { status: 'status' }, words: { initial: 'open', done: 'shipped', closed: 'dropped' } },
    'core/work': { slots: {}, words: {} },
  },
  body: { shape: 'content' },
  prompt: 'One shipment.',
};

const ticket: Tag = {
  id: 'ticket',
  fields: { state: { type: 'enum', values: ['open', 'taken', 'done', 'dropped'] }, owner: 'session' },
  edges: ['relates'],
  gates: [
    { gate: 'transition', field: 'state', from: 'open', to: 'taken' },
    { gate: 'transition', field: 'state', from: 'open', to: 'dropped' },
    { gate: 'transition', field: 'state', from: 'taken', to: 'open' },
    { gate: 'transition', field: 'state', from: 'taken', to: 'done' },
    { gate: 'transition', field: 'state', from: 'done', to: 'open' },
  ],
  roles: {},
  contracts: {
    'core/lifecycle': { slots: { status: 'state' }, words: { initial: 'open', claimed: 'taken', done: 'done', closed: 'dropped' } },
    'core/holder': { slots: { holder: 'owner' }, words: {} },
  },
  body: { shape: 'content' },
  prompt: 'One ticket.',
};

const invoice: Tag = {
  id: 'invoice',
  fields: { amount: 'string' },
  edges: ['relates'],
  gates: [{ gate: 'required', field: 'amount' }],
  roles: {},
  body: { shape: 'content' },
  prompt: 'One invoice.',
};

const ACTIONS: Readonly<Record<string, TagActions>> = {
  shipment: {
    moves: [
      { field: 'status', to: 'shipped', op: 'finish_block' },
      { field: 'status', to: 'dropped', op: 'close_block' },
    ],
    slots: [],
    offers: [],
  },
  ticket: {
    moves: [
      { field: 'state', to: 'done', op: 'finish_block' },
      { field: 'state', to: 'dropped', op: 'close_block' },
      { field: 'state', to: 'taken', op: 'claim_block', label: 'Pick up' },
      { field: 'state', to: 'open', from: ['taken'], op: 'release_block' },
    ],
    slots: [{ field: 'owner', ops: ['claim_block', 'release_block'] }],
    offers: [],
  },
};

const vocabulary: Vocabulary = {
  catalogs: [],
  installed: [],
  findings: [],
  tags: [shipment, ticket, invoice],
  unreadable: [],
  actions: ACTIONS,
  fieldNames: {},
  forms: {},
  laws: {},
  revision: { format: 2, revision: 'test' },
};

function served() {
  const catalog = testTagCatalog();
  catalog.table = new ServedTags(vocabulary);
  catalog.served = true;
  return catalog;
}

const row = (tags: readonly string[], fields: Record<string, unknown> = {}): MarkedRow => ({
  tags,
  fields,
  actions: { ...(ACTIONS[tags[0] ?? ''] ?? { moves: [], slots: [], offers: [] }), revision: 'test' },
});

test('the create menu offers a tag a title alone finishes, and withholds one that needs its own half', () => {
  const catalog = served();

  expect(catalog.titleOnly).toContain('shipment');
  expect(catalog.titleOnly).not.toContain('invoice');
});

test('a status act is the operation the served projection names for the move, and a move no operation owns is a plain write', () => {
  const catalog = served();

  expect(catalog.actions(row(['shipment'], { status: 'open' })).map(act)).toEqual(['set:review']);
  expect(catalog.actions(row(['shipment'], { status: 'review' })).map(act)).toEqual(['finish_block', 'close_block']);

  expect(catalog.actions(row(['ticket'], { state: 'open' })).map(act)).toEqual(['claim_block', 'close_block']);
  expect(catalog.actions(row(['ticket'], { state: 'taken' })).map(act)).toEqual(['release_block', 'finish_block']);
  expect(catalog.actions(row(['ticket'], { state: 'done' })).map(act)).toEqual(['set:open']);
});

test('a multi-tag menu uses the node projection when lifecycle and holder are carried by different tags', () => {
  const flow: Tag = { ...ticket, id: 'flow', contracts: { 'core/lifecycle': ticket.contracts!['core/lifecycle']! } };
  const ownership: Tag = {
    ...invoice,
    id: 'ownership',
    fields: { owner: 'session' },
    gates: [],
    contracts: { 'core/holder': { slots: { holder: 'owner' }, words: {} } },
  };
  const catalog = served();
  catalog.table = new ServedTags({
    ...vocabulary,
    tags: [flow, ownership],
    actions: {
      flow: {
        moves: ACTIONS.ticket!.moves.filter((move) => move.op === 'finish_block' || move.op === 'close_block'),
        slots: [],
        offers: [],
      },
    },
  });
  for (const tags of [
    ['flow', 'ownership'],
    ['ownership', 'flow'],
  ]) {
    expect(catalog.actions({ tags, fields: { state: 'open' }, actions: { ...ACTIONS.ticket!, revision: 'test' } }).map(act)).toEqual([
      'claim_block',
      'close_block',
    ]);
    expect(catalog.actions({ tags, fields: { state: 'taken' }, actions: { ...ACTIONS.ticket!, revision: 'test' } }).map(act)).toEqual([
      'release_block',
      'finish_block',
    ]);
  }
});

test('the outline and status menu wait for a served vocabulary and remain unavailable after a failed read', async () => {
  const pending = Promise.withResolvers<Vocabulary>();
  let answer = pending.promise;
  const catalog = testTagCatalog(1, () => answer);
  const live = row(['shipment'], { status: 'open' });
  const ended = row(['shipment'], { status: 'shipped' });
  const hidden = new Set<'done'>(['done']);
  const loading = catalog.read();
  expect(catalog.showsInOutline(live, hidden)).toBe(false);
  expect(catalog.showsInOutline(ended, hidden)).toBe(false);
  expect(catalog.actions(live)).toEqual([]);
  const failed = new Error('unavailable');
  pending.reject(failed);
  await loading;
  expect(catalog.error).toBe(failed);
  expect(catalog.showsInOutline(live, hidden)).toBe(false);
  answer = Promise.resolve(vocabulary);
  await catalog.retry();
  expect(catalog.showsInOutline(live, hidden)).toBe(true);
  expect(catalog.showsInOutline(ended, hidden)).toBe(false);
  expect(catalog.actions(live).map(act)).toEqual(['set:review']);
});

test('resync preserves the outline while loading and admits a menu only from the matching vocabulary revision', async () => {
  let answer = Promise.resolve(vocabulary);
  const catalog = testTagCatalog(1, () => answer);
  await catalog.read();
  const old = row(['ticket'], { state: 'open' });
  const refreshed = Promise.withResolvers<Vocabulary>();
  answer = refreshed.promise;
  const loading = catalog.read(true);
  expect(catalog.served).toBe(true);
  expect(catalog.standsInOutline(old)).toBe(true);
  expect(catalog.actions(old)).toEqual([]);
  refreshed.resolve({ ...vocabulary, revision: { format: 2, revision: 'changed' } });
  await loading;
  expect(catalog.served).toBe(true);
  expect(catalog.standsInOutline(old)).toBe(false);
  expect(catalog.actions(old)).toEqual([]);
  const fresh = { ...old, actions: { ...old.actions, revision: 'changed' } };
  expect(catalog.standsInOutline(fresh)).toBe(true);
  expect(catalog.actions(fresh).map(act)).toEqual(['claim_block', 'close_block']);
});

test('an earlier read failing late cannot replace the vocabulary of the latest read', async () => {
  const prior = Promise.withResolvers<Vocabulary>();
  let answer = prior.promise;
  const catalog = testTagCatalog(1, () => answer);
  const old = catalog.read();
  answer = Promise.resolve(vocabulary);
  await catalog.read(true);
  prior.reject(new Error('earlier read failed'));
  await old;
  expect(catalog.served).toBe(true);
  expect(catalog.error).toBe(null);
  expect(catalog.declared).toEqual(['shipment', 'ticket', 'invoice']);
});

test('a row rests where its own tag ends, and which resting it hides under is the ending its word means', () => {
  const catalog = served();

  const shipped = row(['shipment'], { status: 'shipped' });
  expect(catalog.isResting(row(['shipment'], { status: 'open' }))).toBe(false);
  expect(catalog.isResting(shipped)).toBe(true);
  expect(catalog.restingState(shipped)).toBe('done');
  expect(catalog.restingState(row(['shipment'], { status: 'dropped' }))).toBe('closed');
  expect(catalog.underway(row(['shipment'], { status: 'review' }))).toBe(true);
  expect(catalog.underway(shipped)).toBe(false);
});

test('a tag this table never read answers as itself, and a node carrying none is a note', () => {
  const catalog = testTagCatalog();

  expect(catalog.tagOf(row(['invoice']))).toBe('invoice');
  expect(catalog.label('invoice')).toBe('#invoice');
  expect(catalog.tagOf(row([]))).toBe(null);
  expect(catalog.word(null)).toBe('note');
});
