import { describe, expect, it } from 'bun:test';
import jsTokens from 'js-tokens';
import type { CommentRange, Language } from './language.js';
import { LANGUAGES } from './languages/index.js';
import { READING_ANSWERS, readComments, readingAnswers, stripProse } from './index.js';
import { lineAt, lineStarts } from './lines.js';

const lexed = (path: string, text: string) => {
  const reading = readComments(path, text);
  if (!reading.lexed) throw new Error(`expected ${path} to lex: ${reading.reason}`);
  return reading;
};

describe('readComments', () => {
  it('finds the comment after a regex literal and none inside it', () => {
    const source = 'const r = /\\/\\//; // why';
    const reading = lexed('a.ts', source);
    expect(reading.comments).toHaveLength(1);
    const [comment] = reading.comments;
    expect(source.slice(comment!.start, comment!.end)).toBe('// why');
    expect(comment!.kind).toBe('prose');
    expect(comment!.line).toBe(1);
  });

  it('reads a division as division, not as a regex that swallows the line', () => {
    const source = 'const a = b / c; // why';
    const reading = lexed('a.ts', source);
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['// why']);
  });

  it('calls a pragma a directive and a marked comment marked', () => {
    const source = '// @ts-expect-error x\n//! why\n// plain\n/// <reference types="bun" />\n';
    const reading = lexed('a.ts', source);
    expect(reading.comments.map((comment) => comment.kind)).toEqual(['directive', 'marked', 'prose', 'directive']);
  });

  it('keeps a marked comment only where it stands alone on one line: a run of them, or a block spanning lines, is prose', () => {
    const source = '//! one\n//! two\nconst a = 1;\n//! alone\n/*! a\n b */\nconst b = 2;\n//! last\n';
    expect(lexed('a.ts', source).comments.map((comment) => comment.kind)).toEqual(['prose', 'prose', 'marked', 'prose', 'marked']);
    expect(lexed('a.ts', '//! one\nconst a = 1;\n//! two\n').comments.map((comment) => comment.kind)).toEqual(['marked', 'marked']);
  });

  it('reads a suite environment pragma as a directive', () => {
    const source = '// @vitest-environment jsdom\n// @jest-environment node\n/** @vitest-environment-options { "url": "http://x" } */\n';
    expect(lexed('a.ts', source).comments.map((comment) => comment.kind)).toEqual(['directive', 'directive', 'directive']);
  });

  it('holds a whole file outside the law when its first comment is the file marker', () => {
    expect(lexed('a.ts', '//! comments\n// why\n').exempt).toBe(true);
    expect(lexed('a.ts', '/*! comments */\n// why\n').exempt).toBe(true);
    expect(lexed('a.svelte', '<!--! comments -->\n<!-- x -->\n').exempt).toBe(true);
    expect(lexed('a.sh', '#! comments\n# why\n').exempt).toBe(true);
    expect(lexed('a.ts', '//! comments here\n').exempt).toBe(false);
    expect(lexed('a.ts', '// why\n//! comments\n').exempt).toBe(false);
  });

  it('does not lex an unterminated template literal', () => {
    const reading = readComments('a.ts', 'const a = `abc ${b} def');
    expect(reading.lexed).toBe(false);
    if (reading.lexed) return;
    expect(reading.reason).toBe('unterminated template literal');
  });

  it('carries a JSDoc block that types a value as a directive', () => {
    const source = '/**\n * Does the thing.\n * @param x - the input\n */\nexport function f(x) { return x; }\n';
    expect(lexed('a.js', source).comments.map((comment) => comment.kind)).toEqual(['directive']);
  });
});

describe('stripProse', () => {
  it('deletes a line nothing else stood on and keeps one code stood on', () => {
    const source = '// why\nconst a = 1; // because\nconst b = 2;\n';
    const stripped = stripProse('a.ts', source);
    expect(stripped.text).toBe('const a = 1;\nconst b = 2;\n');
    expect(stripped.dropped).toEqual([
      { line: 1, head: 'why' },
      { line: 2, head: 'because' },
    ]);
  });

  it('leaves a directive, a marked comment and an exempt file whole', () => {
    const kept = '// @ts-expect-error x\n//! why\nconst a = 1;\n';
    expect(stripProse('a.ts', kept).text).toBe(kept);
    const exempt = '//! comments\n// why\nconst a = 1;\n';
    expect(stripProse('a.ts', exempt)).toEqual({ text: exempt, dropped: [] });
  });

  it('touches nothing when the text did not lex', () => {
    const source = 'const a = `abc\n// why\n';
    expect(stripProse('a.ts', source)).toEqual({ text: source, dropped: [] });
  });

  it('strips only the lines it was pointed at', () => {
    const source = '// one\nconst a = 1;\n// two\n';
    const stripped = stripProse('a.ts', source, new Set([3]));
    expect(stripped.text).toBe('// one\nconst a = 1;\n');
    expect(stripped.dropped).toEqual([{ line: 3, head: 'two' }]);
  });

  it('keeps a block comment no single named line covers whole', () => {
    const source = 'const a = 1;\n/* one\n   two */\nconst b = 2;\n';
    expect(stripProse('a.ts', source, new Set([2])).text).toBe(source);
    expect(stripProse('a.ts', source, new Set([2, 3])).text).toBe('const a = 1;\nconst b = 2;\n');
  });

  it('drops an adjacent prose run whole when its changed line is in the middle', () => {
    const source =
      '// First part of a reason\n// continuing the reason\n// ending the reason\n// @vitest-environment jsdom\n// another reason\nconst a = 1;\n';
    const stripped = stripProse('a.ts', source, new Set([2]));
    expect(stripped.text).toBe('// @vitest-environment jsdom\n// another reason\nconst a = 1;\n');
    expect(stripped.dropped.map((entry) => entry.line)).toEqual([1, 2, 3]);
  });

  it('leaves other prose runs standing across blank lines and code', () => {
    const source = '// part one\n// part two\n\n// separate one\n// separate two\nconst a = 1;\n// final one\n// final two\n';
    const stripped = stripProse('a.ts', source, new Set([2]));
    expect(stripped.text).toBe('\n// separate one\n// separate two\nconst a = 1;\n// final one\n// final two\n');
  });

  it('crosses a Svelte file: markup prose and script prose go, the marked style comment stays', () => {
    const source = [
      '<script lang="ts">',
      '  const y = 1; // y',
      '</script>',
      '',
      '<!-- x -->',
      '<div>hi</div>',
      '',
      '<style>',
      '  /*! z */',
      '  /* w */',
      '  .a { color: red; }',
      '</style>',
      '',
    ].join('\n');
    const stripped = stripProse('a.svelte', source);
    expect(stripped.text).toBe(
      [
        '<script lang="ts">',
        '  const y = 1;',
        '</script>',
        '',
        '<div>hi</div>',
        '',
        '<style>',
        '  /*! z */',
        '  .a { color: red; }',
        '</style>',
        '',
      ].join('\n'),
    );
    expect(stripped.dropped).toEqual([
      { line: 2, head: 'y' },
      { line: 5, head: 'x' },
      { line: 10, head: 'w' },
    ]);
  });
});

describe('the reading identity', () => {
  const swapped = (name: string, comments: Language['comments']): readonly Language[] =>
    LANGUAGES.map((language) => (language.name === name ? { ...language, comments } : language));

  it.each(LANGUAGES.map((language) => language.name))('moves when the %s reader answers any comment differently', (name) => {
    const original = LANGUAGES.find((language) => language.name === name)!;
    const forgetful: Language['comments'] = (text) => {
      const found = original.comments(text);
      return 'unlexable' in found ? found : found.slice(0, -1);
    };

    expect(readingAnswers(swapped(name, forgetful))).not.toEqual(READING_ANSWERS);
  });

  it('moves when the TypeScript reader stops telling a division after an assertion from a regular expression', () => {
    const tokensOnly: Language['comments'] = (text) => {
      const starts = lineStarts(text);
      const ranges: CommentRange[] = [];
      let at = 0;
      for (const token of jsTokens(text)) {
        if ('closed' in token && !token.closed) return { unlexable: 'unterminated token' };
        if (token.type === 'SingleLineComment')
          ranges.push({ start: at, end: at + token.value.length, line: lineAt(starts, at), text: token.value.slice(2) });
        if (token.type === 'MultiLineComment')
          ranges.push({ start: at, end: at + token.value.length, line: lineAt(starts, at), text: token.value.slice(2, -2) });
        at += token.value.length;
      }
      return ranges;
    };

    expect(readingAnswers(swapped('typescript', tokensOnly))).not.toEqual(READING_ANSWERS);
  });
});
