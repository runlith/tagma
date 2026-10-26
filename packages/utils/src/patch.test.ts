import { describe, expect, test } from 'bun:test';
import { parseTextPatch, textPatch, textChanges, type PatchHunk, type PatchLine } from './patch.js';

const marked = (line: PatchLine): string => {
  let out = `${line.kind === 'removed' ? '-' : '+'}`;
  let at = 0;
  for (const span of line.spans) {
    out += `${line.text.slice(at, span.start)}[${line.text.slice(span.start, span.end)}]`;
    at = span.end;
  }
  return out + line.text.slice(at);
};

const changed = (before: string, after: string): readonly PatchLine[] =>
  textPatch(before, after).hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind !== 'context'));

const lines = (hunks: readonly PatchHunk[]): unknown =>
  hunks.map((hunk) => [
    hunk.beforeStart,
    hunk.afterStart,
    hunk.hiddenBefore,
    hunk.hiddenAt,
    hunk.lines.map((l) => [l.kind, l.text, l.before, l.after]),
  ]);

const numbered = (count: number, changes: readonly number[]): string =>
  Array.from({ length: count }, (_, at) => (changes.includes(at) ? `changed ${at}` : `line ${at}`)).join('\n');

const hidden = (count: number, changes: readonly number[], options?: { readonly context: number }): readonly (readonly number[])[] =>
  textPatch(numbered(count, []), numbered(count, changes), options).hunks.map((hunk) => [hunk.hiddenBefore, hunk.hiddenAt]);

describe('textPatch', () => {
  test('line-only changes equal the rich patch’s changed lines without requiring character marks', () => {
    const pairs = [
      ['', 'one\ntwo'],
      ['one\ntwo', ''],
      ['same\ntext', 'same\ntext'],
      ['a\nb\nc\nd', 'a\nB\nc\nD'],
      ['head\n  code();\ntail', 'head\n      code();\ntail'],
      ['a\r\nb\r\n', 'a\r\nc\r\n'],
      ['🙂 日本語\n{\n}\nold', '🙂 other\n{\n}\nnew'],
      ['a\na\nb\na', 'a\nb\na\na'],
      ['x'.repeat(500) + 'a', 'x'.repeat(500) + 'b'],
    ];
    for (const [before, after] of pairs) {
      const rich = textPatch(before!, after!, { context: 0 });
      const plain = textChanges(before!, after!);
      expect([plain.added, plain.removed, plain.timedOut]).toEqual([rich.added, rich.removed, rich.timedOut]);
      const ranges = plain.changes.flatMap((change) => [
        ...Array.from({ length: change.before.end - change.before.start }, (_, at) => ['removed', change.before.start + at + 1]),
        ...Array.from({ length: change.after.end - change.after.start }, (_, at) => ['added', change.after.start + at + 1]),
      ]);
      expect(ranges).toEqual(
        rich.hunks.flatMap((hunk) =>
          hunk.lines
            .filter((line) => line.kind !== 'context')
            .map((line) => [line.kind, (line.kind === 'removed' ? line.before : line.after)!]),
        ),
      );
    }
  });

  test('shows only the changed region, framed by context, with true line numbers', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'X', 'f', 'g', 'h', 'i'].join('\n');
    const { patch, added, removed } = textPatch(before, after);
    expect(added).toBe(1);
    expect(removed).toBe(1);
    expect(patch).toBe(['@@ -2,7 +2,7 @@', ' b', ' c', ' d', '-e', '+X', ' f', ' g', ' h'].join('\n'));
  });

  test('two distant changes become two hunks, two near ones stay one', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index}`);
    const far = [...lines];
    far[2] = 'changed 2';
    far[30] = 'changed 30';
    expect(textPatch(lines.join('\n'), far.join('\n')).patch.match(/^@@/gm)).toHaveLength(2);
    const near = [...lines];
    near[2] = 'changed 2';
    near[5] = 'changed 5';
    expect(textPatch(lines.join('\n'), near.join('\n')).patch.match(/^@@/gm)).toHaveLength(1);
  });

  test('identical texts produce no patch, and an empty side counts every line', () => {
    expect(textPatch('same\ntext', 'same\ntext')).toEqual({ patch: '', hunks: [], added: 0, removed: 0, timedOut: false });
    const created = textPatch('', 'one\ntwo');
    expect(created.added).toBe(2);
    expect(created.removed).toBe(0);
  });

  test('a reindented block is context, while whitespace inside a line still changes it', () => {
    const body = (indent: string) => ['function f() {', ...['const a = 1;', 'return a;'].map((line) => indent + line), '}'];
    expect(textPatch(body('  ').join('\n'), body('      ').join('\n'))).toEqual({
      patch: '',
      hunks: [],
      added: 0,
      removed: 0,
      timedOut: false,
    });
    expect(textPatch('const a = 1;', 'const  a = 1;').added).toBe(1);
  });

  test('two changes with only a brace and blank lines between them stay one hunk', () => {
    const text = (tag: string) =>
      [`alpha(${tag});`, `beta(${tag});`, `gamma(${tag});`, '', '', '}', '', '', '', `delta(${tag});`].join('\n');
    expect(textPatch(text('1'), text('9')).patch.match(/^@@/gm)).toHaveLength(1);
  });

  test('past the scored ceiling the comparison answers what the scored one answers for the same edit', () => {
    const edited = (count: number): readonly [string, string] => {
      const before = ['head', ...Array.from({ length: count - 2 }, (_, at) => `line ${at}`), 'tail'];
      return [before.join('\n'), ['HEAD', ...before.slice(1, -1), 'TAIL'].join('\n')];
    };
    const [smallBefore, smallAfter] = edited(100);
    const [wideBefore, wideAfter] = edited(1000);
    const wide = textPatch(wideBefore, wideAfter);
    expect([wide.added, wide.removed, wide.timedOut]).toEqual([2, 2, false]);
    expect(wide.hunks).toHaveLength(2);
    expect(lines(wide.hunks.slice(0, 1))).toEqual(lines(textPatch(smallBefore, smallAfter).hunks.slice(0, 1)));
  });

  test('a comparison past its deadline states one replaced region and says the clock ran out', () => {
    const text = (tag: string) => Array.from({ length: 2000 }, (_, at) => `const ${tag}${at} = compute(${at});`).join('\n');
    const answer = textPatch(text('a'), text('b'), { deadlineMs: 1 });
    expect(answer.timedOut).toBe(true);
    expect([answer.added, answer.removed]).toEqual([2000, 2000]);
    expect(answer.patch.match(/^@@/gm)).toHaveLength(1);
  });
});

describe('the characters a changed pair carries', () => {
  test('two differences in one line are marked apart, leaving what stands between them alone', () => {
    expect(changed('draw(first, second, third);', 'draw(alpha, second, omega);').map(marked)).toEqual([
      '-draw([first], second, [third]);',
      '+draw([alpha], second, [omega]);',
    ]);
  });

  test('a replaced expression is marked on both sides, and the rest of the line is not', () => {
    expect(changed('const facts = entry.folded ?? [];', 'const facts = foldedFactsOf(entry);').map(marked)).toEqual([
      '-const facts = [entry.folded ?? []];',
      '+const facts = [foldedFactsOf(entry)];',
    ]);
  });

  test('a list losing one entry marks one range, and the range takes the separator with it', () => {
    const pair = changed("import { Baz, Bar, Foo } from 'foo';", "import { Baz, Foo } from 'foo';");
    expect(pair.map(marked)).toEqual(["-import { Baz,[ Bar,] Foo } from 'foo';", "+import { Baz,[] Foo } from 'foo';"]);
    expect(pair.map((line) => line.spans.length)).toEqual([1, 1]);
  });

  test('a line past the ceiling and a line with no partner carry no ranges', () => {
    const long = (tail: string) => `${'x'.repeat(700)}${tail}`;
    expect(changed(long('a'), long('b')).map((line) => line.spans)).toEqual([[], []]);
    expect(changed('one();\ntwo();', 'one();\ninserted();\ntwo();').map((line) => line.spans)).toEqual([[]]);
  });

  test('the stretches the comparison answers state the same lines as reading its text back', () => {
    const answer = textPatch(numbered(60, []), numbered(60, [5, 46]));
    expect(answer.hunks).toHaveLength(2);
    expect(lines(answer.hunks)).toEqual(lines(parseTextPatch(answer.patch)));
  });
});

describe('the context width and what a hunk hides', () => {
  test('the caller names the width, and every hunk says how many lines stand hidden above it', () => {
    expect(hidden(60, [5, 46])).toEqual([
      [2, 1],
      [34, 10],
    ]);
    expect(hidden(60, [5, 46], { context: 20 })).toEqual([[0, 0]]);
    expect(hidden(60, [0])).toEqual([[0, 0]]);
  });

  test('a hidden run is addressed by where it starts, so it stands between that line and the hunk', () => {
    for (const hunk of textPatch(numbered(60, []), numbered(60, [0, 46])).hunks) {
      if (hunk.hiddenBefore === 0) expect(hunk.hiddenAt).toBe(0);
      else expect(hunk.hiddenAt + hunk.hiddenBefore).toBe(hunk.beforeStart);
    }
  });

  test('a hunk opens only where a line is really hidden, so no break stands over nothing', () => {
    expect(hidden(40, [5, 12])).toEqual([[2, 1]]);
    expect(hidden(40, [5, 13])).toEqual([
      [2, 1],
      [1, 10],
    ]);
  });
});

describe('parseTextPatch', () => {
  test('reads back the lines and the numbers each side counts from', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'X', 'f', 'g', 'h', 'i'].join('\n');
    const [hunk, ...rest] = parseTextPatch(textPatch(before, after).patch);
    expect(rest).toEqual([]);
    expect(hunk).toBeDefined();
    expect([hunk?.beforeStart, hunk?.afterStart]).toEqual([2, 2]);
    expect(hunk?.lines.map((line) => [line.kind, line.text, line.before, line.after])).toEqual([
      ['context', 'b', 2, 2],
      ['context', 'c', 3, 3],
      ['context', 'd', 4, 4],
      ['removed', 'e', 5, null],
      ['added', 'X', null, 5],
      ['context', 'f', 6, 6],
      ['context', 'g', 7, 7],
      ['context', 'h', 8, 8],
    ]);
  });

  test('every hunk of a patch is read, each numbered from its own header', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index}`);
    const changed = [...lines];
    changed[2] = 'changed 2';
    changed[30] = 'changed 30';
    const hunks = parseTextPatch(textPatch(lines.join('\n'), changed.join('\n')).patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.beforeStart).toBe(1);
    expect(hunks[1]?.beforeStart).toBe(28);
    expect(hunks[1]?.lines[0]?.before).toBe(28);
  });

  test('a patch with nothing in it states no hunk', () => {
    expect(parseTextPatch('')).toEqual([]);
  });

  test('a blank line is context, not a stray line outside the hunk', () => {
    const [hunk] = parseTextPatch(textPatch('a\n\nb', 'a\n\nc').patch);
    expect(hunk?.lines.map((line) => [line.kind, line.text])).toEqual([
      ['context', 'a'],
      ['context', ''],
      ['removed', 'b'],
      ['added', 'c'],
    ]);
  });
});
