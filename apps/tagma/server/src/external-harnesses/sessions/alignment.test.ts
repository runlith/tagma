import { expect, test } from 'bun:test';
import type { HarnessCut, HarnessCutMaking } from '../contract/service/adapter.js';
import { ALIGNMENT_WORDS, alignmentOf, type AlignmentFacts } from './alignment.js';

const launch: HarnessCutMaking = { _tag: 'Launch', argv: () => [], rows: 'copied' };
const prepare: HarnessCutMaking = {
  _tag: 'Prepare',
  server: () => ({ program: 'cut', args: [] }),
  initialize: { request: () => ({ method: 'initialize', params: {} }), judge: () => ({ _tag: 'Accept', value: undefined }) },
  fork: { request: () => ({ method: 'fork', params: {} }), judge: () => ({ _tag: 'Accept', value: { id: 'Y', artifact: '/Y' } }) },
  rows: 'unaddressed',
};
const both: HarnessCut = { whole: prepare, point: prepare };
const header = { account: 'a', replaced: null, origin: null };
const facts = (over: Partial<AlignmentFacts>): AlignmentFacts => ({
  root: 'X',
  plain: false,
  cut: both,
  header,
  account: 'a',
  point: { _tag: 'None' },
  unmapped: false,
  kept: 2,
  ...over,
});

test('the launch keeps, cuts or seeds the vendor session from the map, and names only a vendor copy that was due and did not happen', () => {
  const cut = { _tag: 'Cut', run: 'r2', address: 'a1', ordinal: 1 } as const;
  expect(alignmentOf(facts({}))).toEqual({ _tag: 'Keep' });
  expect(alignmentOf(facts({ point: cut }))).toEqual({
    _tag: 'Cut',
    ask: { root: 'X', address: 'a1' },
    making: prepare,
    at: 'r2',
    own: true,
  });
  expect(alignmentOf(facts({ point: { _tag: 'Fresh' } }))).toEqual({ _tag: 'Fresh', reason: ALIGNMENT_WORDS.uncut, replaced: 'X' });
  expect(alignmentOf(facts({ point: cut, cut: { whole: launch, point: null } }))).toEqual({ _tag: 'Fresh', reason: null, replaced: 'X' });
  expect(alignmentOf(facts({ header: null, unmapped: true }))).toEqual({ _tag: 'Fresh', reason: ALIGNMENT_WORDS.unmapped, replaced: 'X' });
  expect(alignmentOf(facts({ account: 'b' }))).toEqual({ _tag: 'Fresh', reason: ALIGNMENT_WORDS.account, replaced: null });
  expect(alignmentOf(facts({ point: { _tag: 'Fresh' }, kept: 0 }))).toEqual({ _tag: 'Fresh', reason: null, replaced: 'X' });
});

test('a fork child cuts from the root it was born from, before the first copied turn it took out itself, unless its CLI, account or plainness cannot', () => {
  const born = (address: string | null, over: Partial<AlignmentFacts> = {}) =>
    alignmentOf(facts({ root: null, header: { ...header, origin: { root: 'X', address } }, ...over }));
  expect(born(null)).toEqual({ _tag: 'Cut', ask: { root: 'X', address: null }, making: prepare, at: null, own: false });
  const rewound = { _tag: 'Cut', run: 'r2', address: 'a1', ordinal: 1 } as const;
  expect(born(null, { point: rewound })).toEqual({ _tag: 'Cut', ask: { root: 'X', address: 'a1' }, making: prepare, at: 'r2', own: false });
  expect(born(null, { point: { _tag: 'Fresh' } })).toEqual({ _tag: 'Fresh', reason: ALIGNMENT_WORDS.uncut, replaced: null });
  expect(born('a1', { cut: { whole: launch, point: null } })).toEqual({ _tag: 'Fresh', reason: null, replaced: null });
  expect(born(null, { account: 'b' })).toEqual({ _tag: 'Fresh', reason: ALIGNMENT_WORDS.account, replaced: null });
  expect(born(null, { plain: true, cut: { whole: launch, point: null } })).toEqual({ _tag: 'Fresh', reason: null, replaced: null });
  expect(alignmentOf(facts({ plain: true, point: { _tag: 'Fresh' } }))).toEqual({ _tag: 'Keep' });
});
