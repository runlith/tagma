import { expect, test } from 'bun:test';
import { type LineHunk, workspaceChangeHunk } from './hunk';

const crlf = 'one\r\ntwo\r\nthree\r\n';

const unreturned = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);

const applied = (before: string, after: string, hunk: LineHunk, normalized = false): void => {
  const from = before.split('\n');
  const to = after.split('\n');
  const at = hunk.firstLine - 1;
  const spliced = [...from.slice(0, at), ...to.slice(at, at + hunk.newLines), ...from.slice(at + hunk.oldLines)];
  expect(normalized ? spliced.map(unreturned) : spliced).toEqual(normalized ? to.map(unreturned) : to);
  const start = at - hunk.windowBefore;
  const oldWindow = hunk.oldText === '' ? 0 : hunk.oldText.split('\n').length - (hunk.oldText.endsWith('\n') ? 1 : 0);
  const after_ = oldWindow - hunk.windowBefore - hunk.oldLines;
  expect(after_).toBeGreaterThanOrEqual(0);
  expect(from.slice(start, start + oldWindow).join('\n')).toBe(hunk.oldText.replace(/\n$/, ''));
};

test('the span names the changed lines exactly while the window around them is widened until it stands once', () => {
  const before = 'a\nx\na\nx\na\n';
  const after = 'a\nx\na\ny\na\n';
  const hunk = workspaceChangeHunk(before, after);
  expect(hunk).toMatchObject({ firstLine: 4, oldLines: 1, newLines: 1 });
  expect(hunk?.windowBefore).toBeGreaterThan(0);
  applied(before, after, hunk as LineHunk);
});

test('where git normalizes line endings, an LF rewrite changing one line is a one-line hunk, and an endings-only rewrite is none', () => {
  const hunk = workspaceChangeHunk(crlf, 'one\nTWO\nthree\n', true);
  expect(hunk).toEqual({ firstLine: 2, oldLines: 1, newLines: 1, windowBefore: 0, oldText: 'two\r\n', newText: 'TWO\n' });
  applied(crlf, 'one\nTWO\nthree\n', hunk as LineHunk, true);
  expect(workspaceChangeHunk(crlf, 'one\ntwo\nthree\n', true)).toBeUndefined();
  expect(workspaceChangeHunk(crlf, 'one\nTWO\nthree\n')?.newLines).toBe(3);
});

test('a file born from nothing and a file emptied are spans over every line of the side that has them', () => {
  const born = workspaceChangeHunk('', 'one\ntwo\n');
  expect(born).toMatchObject({ firstLine: 1, oldLines: 0, newLines: 2, windowBefore: 0 });
  applied('', 'one\ntwo\n', born as LineHunk);
  const emptied = workspaceChangeHunk('one\ntwo\n', '');
  expect(emptied).toMatchObject({ firstLine: 1, oldLines: 2, newLines: 0, windowBefore: 0 });
  applied('one\ntwo\n', '', emptied as LineHunk);
});
