import { expect, test } from 'bun:test';
import { contentDigest } from '@runlith/files/content';
import { type MoveClaim, type Pairing, pairingOf, type QueuedMove, type Standing } from './commandRows.js';
import { MOVED_BYTES } from './moves.js';

const ABSENT = contentDigest('');
const MOVED = contentDigest('moved bytes\n');
const UNPAIRED: Pairing = { renames: new Map(), adopted: new Set() };

const gone = (name: string, claim: MoveClaim, digest = MOVED): QueuedMove => ({
  name,
  before: digest,
  after: ABSENT,
  present: false,
  existed: true,
  written: null,
  bytes: null,
  link: false,
  mode: null,
  claim,
});

const born = (name: string, claim: MoveClaim, digest = MOVED): QueuedMove => ({
  ...gone(name, claim),
  before: null,
  after: digest,
  present: true,
  existed: false,
});

const startOf = (move: QueuedMove): Standing => (move.present ? { hash: ABSENT, present: false } : { hash: move.before, present: true });

const sized =
  (bytes: number) =>
  (digest: string): number | null =>
    digest === MOVED ? bytes : digest === ABSENT ? 0 : null;

test('a deletion another command overlapped pairs with this session’s birth of the same bytes and becomes this session’s', () => {
  expect(pairingOf([gone('a.ts', 'overlap'), born('b.ts', 'mine')], startOf, sized(MOVED_BYTES))).toEqual({
    renames: new Map([['b.ts', 'a.ts']]),
    adopted: new Set(['a.ts']),
  });
});

test('a side no command line names is never adopted by pairing with this session’s birth of the same bytes', () => {
  expect(pairingOf([gone('a.ts', 'unproven'), born('b.ts', 'mine')], startOf, sized(MOVED_BYTES))).toEqual(UNPAIRED);
  expect(pairingOf([gone('a.ts', 'mine'), born('b.ts', 'unproven')], startOf, sized(MOVED_BYTES))).toEqual(UNPAIRED);
});

test('two overlapped sides, an ambiguous birth, content below the moved size and empty content pair nothing', () => {
  expect(pairingOf([gone('a.ts', 'overlap'), born('b.ts', 'overlap')], startOf, sized(MOVED_BYTES))).toEqual(UNPAIRED);
  expect(pairingOf([gone('a.ts', 'overlap'), born('b.ts', 'mine'), born('c.ts', 'mine')], startOf, sized(MOVED_BYTES))).toEqual(UNPAIRED);
  expect(pairingOf([gone('a.ts', 'overlap'), born('b.ts', 'mine')], startOf, sized(MOVED_BYTES - 1))).toEqual(UNPAIRED);
  expect(pairingOf([gone('a.ts', 'overlap', ABSENT), born('b.ts', 'mine', ABSENT)], startOf, sized(MOVED_BYTES))).toEqual(UNPAIRED);
});
