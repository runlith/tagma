import { describe, expect, test } from 'bun:test';
import { Result } from 'effect';
import { applyLineEdits, splitBodies, splitLines } from './lines';

const applied = (base: string, ...edits: Parameters<typeof applyLineEdits>[1][number][]): string =>
  Result.getOrThrow(applyLineEdits(base, edits));

describe('applying line edits', () => {
  test('lines outside the edits keep their own endings, mixed ones included', () => {
    expect(applied('a\r\nb\nc\r\nd\r\n', { from: 1, to: 2, lines: ['B'] })).toBe('a\r\nB\r\nc\r\nd\r\n');
    expect(applied('a\nb\r\nc\n', { from: 0, to: 1, lines: ['A'] })).toBe('A\nb\r\nc\n');
  });

  test('new lines take the ending most of the file uses', () => {
    expect(applied('a\r\nb\r\nc\n', { from: 1, to: 1, lines: ['x', 'y'] })).toBe('a\r\nx\r\ny\r\nb\r\nc\n');
    expect(applied('only', { from: 0, to: 0, lines: ['x'] })).toBe('x\nonly');
  });

  test('a byte order mark survives an edit of the first line', () => {
    expect(applied('\uFEFFa\nb\n', { from: 0, to: 1, lines: ['A'] })).toBe('\uFEFFA\nb\n');
  });

  test('the last line carries no ending, so the final line ending is an edit of the line after it', () => {
    expect(applied('a\nb', { from: 1, to: 2, lines: ['B'] })).toBe('a\nB');
    expect(applied('a\nb', { from: 2, to: 2, lines: ['c', 'd'] })).toBe('a\nb\nc\nd');
    expect(applied('a', { from: 1, to: 1, lines: [''] })).toBe('a\n');
    expect(applied('a\n', { from: 1, to: 2, lines: [] })).toBe('a');
    expect(applied('a\r\nb\r\n', { from: 2, to: 3, lines: [] })).toBe('a\r\nb');
    expect(applied('a\nb', { from: 1, to: 2, lines: [] })).toBe('a');
  });

  test('an empty file is one empty line that typing fills and a deletion leaves', () => {
    expect(applied('', { from: 0, to: 1, lines: ['a'] })).toBe('a');
    expect(applied('a\n', { from: 0, to: 2, lines: [''] })).toBe('');
  });

  test('a lone carriage return is content, a line break inside a body is refused', () => {
    expect(splitBodies('a\rb\r\nc\r')).toEqual(['a\rb', 'c\r']);
    expect(applied('a\rb\nc', { from: 1, to: 2, lines: ['c\r'] })).toBe('a\rb\nc\r');
    expect(applyLineEdits('a\nb', [{ from: 0, to: 1, lines: ['x\r'] }])).toEqual(Result.fail('line'));
    expect(applyLineEdits('a\n', [{ from: 0, to: 1, lines: ['x\ny'] }])).toEqual(Result.fail('line'));
  });

  test('several edits apply against the base lines', () => {
    expect(applied('a\nb\nc\nd\n', { from: 0, to: 1, lines: ['A', 'A2'] }, { from: 2, to: 4, lines: ['CD'] })).toBe('A\nA2\nb\nCD\n');
  });

  test('edits that leave the file or overlap are refused', () => {
    expect(applyLineEdits('a\n', [{ from: 0, to: 3, lines: [] }])).toEqual(Result.fail('range'));
    expect(
      applyLineEdits('a\nb\n', [
        { from: 1, to: 2, lines: [] },
        { from: 0, to: 1, lines: [] },
      ]),
    ).toEqual(Result.fail('order'));
  });
});

describe('splitting lines', () => {
  test('k line breaks make k + 1 lines, each keeping its own ending', () => {
    expect(splitLines('a\r\nb\nc')).toEqual(['a\r\n', 'b\n', 'c']);
    expect(splitLines('a\n')).toEqual(['a\n', '']);
    expect(splitLines('')).toEqual(['']);
  });
});
