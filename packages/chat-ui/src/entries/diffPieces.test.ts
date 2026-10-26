import { expect, test } from 'vitest';
import { diffPieces } from './diffPieces';

const drawn = (pieces: readonly { text: string; color?: string; marked: boolean }[]) =>
  pieces.map((piece) => [piece.text, piece.color, piece.marked]);

test('a line with no ranges is its tokens, and nothing is marked', () => {
  const tokens = [
    { text: 'const ', color: '#a' },
    { text: 'value', color: '#b' },
  ];

  expect(drawn(diffPieces('const value', tokens, []))).toEqual([
    ['const ', '#a', false],
    ['value', '#b', false],
  ]);
});

test('a line with neither tokens nor ranges is one piece holding the line', () => {
  expect(drawn(diffPieces('const value', undefined, []))).toEqual([['const value', undefined, false]]);
});

test('a range cuts the line into what stayed, what moved, and what stayed', () => {
  const tokens = [
    { text: 'const ', color: '#a' },
    { text: 'alpha', color: '#b' },
    { text: ' = 1', color: '#a' },
  ];

  expect(drawn(diffPieces('const alpha = 1', tokens, [{ start: 6, end: 11 }]))).toEqual([
    ['const ', '#a', false],
    ['alpha', '#b', true],
    [' = 1', '#a', false],
  ]);
});

test('a range ending mid-token draws both halves in that token colour', () => {
  const tokens = [{ text: 'const value', color: '#a' }];

  expect(drawn(diffPieces('const value', tokens, [{ start: 6, end: 11 }]))).toEqual([
    ['const ', '#a', false],
    ['value', '#a', true],
  ]);
});

test('two ranges on one line each mark their own characters', () => {
  const spans = [
    { start: 0, end: 3 },
    { start: 7, end: 10 },
  ];

  expect(drawn(diffPieces('abcdefghij', undefined, spans))).toEqual([
    ['abc', undefined, true],
    ['defg', undefined, false],
    ['hij', undefined, true],
  ]);
});

test('a range reaching the line end leaves nothing after it', () => {
  expect(drawn(diffPieces('abcdef', undefined, [{ start: 3, end: 6 }]))).toEqual([
    ['abc', undefined, false],
    ['def', undefined, true],
  ]);
});
