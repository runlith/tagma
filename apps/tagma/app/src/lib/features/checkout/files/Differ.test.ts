import { expect, test } from 'vitest';
import { Differ } from './Differ.js';
import { diffLines, type LineEdit } from './lineDiff.js';

test('a newer request of the same asker makes the older answer stale, while another asker is untouched', async () => {
  const waiting: ((edits: readonly LineEdit[]) => void)[] = [];
  const differ = new Differ(() => new Promise((resolve) => waiting.push(resolve)));

  const first = differ.edits('a', 'b', 'doc');
  const other = differ.edits('a', 'b', 'elsewhere');
  const second = differ.edits('a', 'c', 'doc');
  for (const resolve of waiting) resolve([{ from: 0, to: 1, lines: ['x'] }]);

  expect(await first).toBeNull();
  expect(await second).toEqual([{ from: 0, to: 1, lines: ['x'] }]);
  expect(await other).toEqual([{ from: 0, to: 1, lines: ['x'] }]);
});

test('the edits between two texts, applied to the first, give the second, and line endings do not matter', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['one\ntwo\nthree', 'one\n2\nthree'],
    ['', 'new\nfile'],
    ['gone\n', ''],
    ['a\nb\nc\nd', 'a\nc\nd\ne'],
    ['same\r\nlines\r\n', 'same\nlines\n'],
  ];
  for (const [before, after] of cases) {
    const edits = diffLines(before, after);
    const lines = before.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let at = 0;
    for (const edit of edits) {
      out.push(...lines.slice(at, edit.from), ...edit.lines);
      at = edit.to;
    }
    out.push(...lines.slice(at));
    expect(out.join('\n')).toBe(after.replace(/\r\n/g, '\n'));
  }
});
