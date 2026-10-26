import { expect, test } from 'bun:test';
import { reusableCut, snapshotRetention } from './snapshotPolicy.js';

const first = { name: 'first', hash: 'first-hash' };
const second = { name: 'second', hash: 'second-hash' };

test('a retry reuses only the same complete pending batch and selected-source witness', () => {
  const cut = { pending: [first, second], source: 'selected-state' };
  expect(reusableCut(cut, { ...cut, pending: [{ ...first }, { ...second }] })).toBe(true);
  expect(reusableCut(cut, { ...cut, source: 'intervening-write' })).toBe(false);
  expect(reusableCut(cut, { ...cut, pending: [second] })).toBe(false);
  expect(reusableCut(cut, { ...cut, pending: [first, { ...second, hash: 'changed-sql' }] })).toBe(false);
  expect(reusableCut(cut, { ...cut, pending: [first, { ...second, name: 'other' }] })).toBe(false);
  expect(reusableCut(cut, { ...cut, pending: [second, first] })).toBe(false);
  expect(reusableCut({ pending: [], source: 'empty' }, { pending: [], source: 'empty' })).toBe(false);
});

test('retention needs applied migrations, a later process and successful admission', () => {
  expect(snapshotRetention(undefined, 'capture-boot', false, false)).toBe('keep');
  expect(snapshotRetention(undefined, 'capture-boot', true, false)).toBe('complete');
  expect(snapshotRetention('capture-boot', 'capture-boot', true, true)).toBe('keep');
  expect(snapshotRetention('capture-boot', 'later-boot', true, false)).toBe('queue');
  expect(snapshotRetention('capture-boot', 'later-boot', true, true)).toBe('release');
  expect(snapshotRetention('capture-boot', 'later-boot', false, true)).toBe('keep');
  expect(snapshotRetention(undefined, 'later-boot', true, true)).toBe('complete');
});
