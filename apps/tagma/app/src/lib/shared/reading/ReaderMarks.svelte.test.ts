// @vitest-environment jsdom
import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { ReaderMarks } from './ReaderMarks.svelte.js';

test('a mark stored before its address carried a branch is read on the canonical checkout', () => {
  const marks = new ReaderMarks(
    makeStorage({
      'tagma.readAt': JSON.stringify({ alpha: '2026-09-05T00:00:00Z' }),
      'tagma.journalSeen': JSON.stringify({ '5': 42 }),
      'tagma.visited': JSON.stringify({ '5': ['beta'] }),
    }),
  );

  expect(marks.seen.get('\talpha')).toBe('2026-09-05T00:00:00Z');
  expect(marks.journal.get('5:')).toBe(42);
  expect(marks.trail.get('5')).toEqual(['beta']);
});

test('two tabs marking different entries of one record keep both marks', () => {
  const storage = makeStorage();
  const first = new ReaderMarks(storage);
  const second = new ReaderMarks(storage);

  first.seen.set('\talpha', '2026-09-05T00:00:00Z');
  second.seen.set('\tbeta', '2026-09-06T00:00:00Z');

  const reloaded = new ReaderMarks(storage);
  expect(reloaded.seen.get('\talpha')).toBe('2026-09-05T00:00:00Z');
  expect(reloaded.seen.get('\tbeta')).toBe('2026-09-06T00:00:00Z');
});

test('a record this browser cannot parse costs that record and no other', () => {
  const marks = new ReaderMarks(makeStorage({ 'tagma.readAt': '{ not json', 'tagma.visited': JSON.stringify({ '5': ['beta'] }) }));

  expect(marks.seen.get('\talpha')).toBeUndefined();
  expect(marks.trail.get('5')).toEqual(['beta']);
});
