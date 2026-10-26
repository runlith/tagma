import { expect, test } from 'vitest';
import { compactCount, lineCount, sumLines } from './lineCount.js';

test('a count prints whole under a thousand, one decimal under ten thousand, and whole thousands past it', () => {
  expect([999, 1000, 9309, 9999, 10_000, 12_883].map(compactCount)).toEqual(['999', '1k', '9.3k', '10k', '10k', '13k']);
});

test('a side that moved nothing is not printed, and a path with no measured change prints nothing at all', () => {
  expect(lineCount({ added: 18, removed: 0 })).toEqual({ kind: 'lines', added: '+18', removed: null });
  expect(lineCount({ added: 0, removed: 27 })).toEqual({ kind: 'lines', added: null, removed: '−27' });
  expect(lineCount({ added: 0, removed: 0 })).toBeNull();
  expect(lineCount('unweighed')).toBeNull();
  expect(lineCount('binary')).toEqual({ kind: 'binary' });
});

test('a sum counts what git weighed and leaves binary and unweighed paths out rather than as zero', () => {
  expect(sumLines([{ added: 4, removed: 2 }, 'binary', 'unweighed', { added: 1, removed: 0 }])).toEqual({
    added: 5,
    removed: 2,
  });
});
