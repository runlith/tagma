import { parseTextPatch } from '@runlith/utils/patch';
import { expect, test } from 'vitest';
import { gutterDigits, patchRows, patchText } from './patchRows';

test('every line is a row, the break between two stretches is a row, and none shares a key', () => {
  const rows = patchRows(
    parseTextPatch(['@@ -1,2 +1,2 @@', ' one', '-two', '@@ -40,3 +40,3 @@', ' forty', '+added', ' forty-two'].join('\n')),
  );

  expect(rows.map((row) => row.kind)).toEqual(['line', 'line', 'break', 'line', 'line', 'line']);
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  const gap = rows.find((row) => row.kind === 'break');
  expect(gap?.kind === 'break' && [gap.hiddenAt, gap.hiddenBefore]).toEqual([3, 37]);
  const last = rows.at(-1);
  expect(last?.kind === 'line' && [last.hunk, last.index]).toEqual([1, 2]);
});

test('the document a highlighter reads is the two sides as the text they are', () => {
  const rows = patchRows(
    parseTextPatch(['@@ -1,2 +1,2 @@', ' const a = 1;', '-const b = 2;', '@@ -40,2 +40,2 @@', '+const c = 3;', ' done'].join('\n')),
  );

  expect(patchText(rows)).toBe(['const a = 1;', 'const b = 2;', 'const c = 3;', 'done'].join('\n'));
  expect(rows.filter((row) => row.kind === 'line').map((row) => row.at)).toEqual([0, 1, 2, 3]);
});

test('the gutters are as wide as the widest number the patch states, on either side', () => {
  expect(gutterDigits(parseTextPatch(['@@ -7,1 +7,1 @@', ' seven'].join('\n')))).toBe(1);
  expect(gutterDigits(parseTextPatch(['@@ -998,2 +12345,2 @@', ' held', '+added'].join('\n')))).toBe(5);
  expect(gutterDigits([])).toBe(1);
});
