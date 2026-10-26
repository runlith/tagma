import { describe, expect, it } from 'bun:test';
import { readComments, stripProse } from '../index.js';
import type { CommentRange, Language } from '../language.js';
import { LANGUAGES, languageOf } from './index.js';

const percent: Language = {
  name: 'zz',
  extensions: ['.zz'],
  comments(text) {
    const ranges: CommentRange[] = [];
    let line = 1;
    let at = 0;
    while (at < text.length) {
      const character = text[at];
      if (character === '\n') {
        line += 1;
        at += 1;
        continue;
      }
      if (character !== '%') {
        at += 1;
        continue;
      }
      const broke = text.indexOf('\n', at);
      const end = broke === -1 ? text.length : broke;
      ranges.push({ start: at, end, line, text: text.slice(at + 1, end) });
      at = end;
    }
    return ranges;
  },
  directives: [{ opens: 'zz-ignore', side: 'content' }],
  marker: { line: '%' },
};

const withPercent = [...LANGUAGES, percent];

const backwards: Language = {
  ...percent,
  comments(text) {
    const found = percent.comments(text);
    return 'unlexable' in found ? found : [...found].reverse();
  },
};

describe('the registry', () => {
  it('answers nothing for a language no adapter claims', () => {
    expect(languageOf('a.c')).toBe(null);
    const reading = readComments('a.c', 'int a = 1; // why');
    expect(reading.lexed).toBe(false);
    if (reading.lexed) return;
    expect(reading.reason).toBe('unknown language');
  });

  it('reads a language nothing above the registry knows, added as one row', () => {
    const source = '%! why\n% prose\n%zz-ignore x\ncode\n';
    const reading = readComments('a.zz', source, withPercent);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => comment.kind)).toEqual(['marked', 'prose', 'directive']);
    expect(reading.exempt).toBe(false);
    expect(readComments('a.zz', '%! comments\n% prose\n', withPercent)).toMatchObject({ exempt: true });
    expect(stripProse('a.zz', source, undefined, withPercent).text).toBe('%! why\n%zz-ignore x\ncode\n');
  });

  it('refuses an adapter answering its ranges out of order instead of mangling the text', () => {
    const source = '% one\ncode\n% two\n';
    expect(readComments('a.zz', source, [backwards])).toEqual({
      lexed: false,
      reason: 'comment ranges out of order',
    });
    expect(stripProse('a.zz', source, undefined, [backwards])).toEqual({ text: source, dropped: [] });
    expect(stripProse('a.zz', source, undefined, [percent]).text).toBe('code\n');
  });

  it('claims every extension exactly once', () => {
    const seen = new Set<string>();
    for (const language of LANGUAGES) {
      for (const extension of language.extensions) {
        expect(seen.has(extension)).toBe(false);
        seen.add(extension);
      }
    }
  });
});

describe('the shipped adapters', () => {
  it('reads TypeScript comments and no string that looks like one', () => {
    const source = 'const a = "// not";\nconst b = `${a} // not`;\n// yes\n';
    const reading = readComments('a.ts', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['// yes']);
  });

  it('reads TypeScript that divides after a non-null assertion', () => {
    const source =
      'declare const deltas: number[];\n' +
      'declare const rate: Map<number, number>;\n' +
      '// per-sample rate\n' +
      'const id = deltas[0]!;\n' +
      'rate.set(id, (rate.get(id) ?? 0) + deltas[1]! / 1_000);\n' +
      'const half = Math.max(deltas[0]!)! / 2;\n' +
      'const direct = id! / 2;\n' +
      'const chained = id!! / 2;\n';
    const reading = readComments('a.ts', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['// per-sample rate']);
    expect(stripProse('a.ts', source).text).toBe(
      'declare const deltas: number[];\n' +
        'declare const rate: Map<number, number>;\n' +
        'const id = deltas[0]!;\n' +
        'rate.set(id, (rate.get(id) ?? 0) + deltas[1]! / 1_000);\n' +
        'const half = Math.max(deltas[0]!)! / 2;\n' +
        'const direct = id! / 2;\n' +
        'const chained = id!! / 2;\n',
    );
    expect(readComments('a.ts', 'const pattern = /unterminated;\n')).toEqual({
      lexed: false,
      reason: 'unterminated regular expression',
    });
  });

  it('reads several assertion divisions around genuine regexes and comments', () => {
    const source =
      '// head\n' +
      'const a = xs[0]! / 2;\n' +
      'const re = /a\\/b/;\n' +
      '// middle\n' +
      'const b = f(x)! / g(y)! / 2;\n' +
      'if (/re/.test(s)) {\n' +
      '  const c = v! / 3;\n' +
      '}\n' +
      '// tail\n';
    const reading = readComments('a.ts', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => [source.slice(comment.start, comment.end), comment.line])).toEqual([
      ['// head', 1],
      ['// middle', 4],
      ['// tail', 9],
    ]);
    expect(stripProse('a.ts', source).text).toBe(
      'const a = xs[0]! / 2;\n' +
        'const re = /a\\/b/;\n' +
        'const b = f(x)! / g(y)! / 2;\n' +
        'if (/re/.test(s)) {\n' +
        '  const c = v! / 3;\n' +
        '}\n',
    );
  });

  it('keeps an unterminated regex unlexable when the ! is a negation, not an assertion', () => {
    expect(readComments('a.ts', 'const ok = !/closed/.test(s);\n')).toMatchObject({ lexed: true });
    expect(readComments('a.ts', 'const bad = !/unterminated;\n')).toEqual({
      lexed: false,
      reason: 'unterminated regular expression',
    });
    expect(readComments('a.ts', '!/unterminated;\n')).toEqual({
      lexed: false,
      reason: 'unterminated regular expression',
    });
  });

  it('reads past a template that starts on an assertion-division line', () => {
    const source = 'const x = a! / 2; const s = `hi\nbye`;\n// tail\n';
    const reading = readComments('a.ts', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => [source.slice(comment.start, comment.end), comment.line])).toEqual([['// tail', 3]]);
  });

  it('refuses a prefix negation that only looks like an assertion after a site', () => {
    expect(readComments('a.ts', 'a!/b++\n!/')).toEqual({
      lexed: false,
      reason: 'unterminated regular expression',
    });
  });

  it('exempts a CSS file through the only marker CSS has', () => {
    expect(readComments('a.css', '/*! comments */\n/* why */\n')).toMatchObject({ exempt: true });
  });

  it('claims no JSX until an adapter for it is written', () => {
    expect(languageOf('a.tsx')).toBe(null);
    expect(readComments('a.tsx', 'const a = <div>http://x</div>; // why')).toEqual({
      lexed: false,
      reason: 'unknown language',
    });
  });

  it('reads CSS block comments and no string that looks like one', () => {
    const source = '.a { content: "/* not */"; }\n/* why */\n/*! keep */\n';
    const reading = readComments('a.css', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => [source.slice(comment.start, comment.end), comment.kind])).toEqual([
      ['/* why */', 'prose'],
      ['/*! keep */', 'marked'],
    ]);
  });

  it('does not lex an unterminated CSS comment', () => {
    expect(readComments('a.css', '.a { color: red; }\n/* why\n')).toEqual({
      lexed: false,
      reason: 'unterminated comment',
    });
  });

  it('reads hash comments, calls the shebang a directive and keeps a quoted hash', () => {
    const source = '#!/usr/bin/env bash\necho "a # not"\n# why\necho b # tail\n';
    const reading = readComments('a.sh', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => [source.slice(comment.start, comment.end), comment.kind])).toEqual([
      ['#!/usr/bin/env bash', 'directive'],
      ['# why', 'prose'],
      ['# tail', 'prose'],
    ]);
  });

  it('knows a Dockerfile by its name and a python triple-quoted string', () => {
    expect(languageOf('services/api/Dockerfile')?.name).toBe('hash');
    const source = 'x = """\n# not a comment\n"""\n# why\n';
    const reading = readComments('a.py', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['# why']);
  });

  it('reads a script tag whose attribute value carries a closing angle bracket', () => {
    const source = '<script lang="ts" generics="T extends Map<string, T>">\n// a\n</script>\n<p>x</p>\n';
    const reading = readComments('a.svelte', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['// a']);
  });

  it('keeps the pragmas a tool writes against the whole comment, spaced or not', () => {
    const source = '//# sourceMappingURL=a.js.map\n///<reference types="bun" />\n/// <reference types="node" />\n// why\n';
    const reading = readComments('a.ts', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => comment.kind)).toEqual(['directive', 'directive', 'directive', 'prose']);
    expect(stripProse('a.ts', source).text).toBe(
      '//# sourceMappingURL=a.js.map\n///<reference types="bun" />\n/// <reference types="node" />\n',
    );
  });

  it('keeps the source-map pragma a bundler writes into CSS', () => {
    const source = '.a { color: red; }\n/* why */\n/*# sourceMappingURL=a.css.map */\n';
    expect(stripProse('a.css', source).text).toBe('.a { color: red; }\n/*# sourceMappingURL=a.css.map */\n');
  });

  it('refuses a shell heredoc instead of reading a line inside it as a comment', () => {
    const source = "cat <<'EOF'\n# not a comment\nEOF\n";
    expect(readComments('a.sh', source)).toEqual({ lexed: false, reason: 'heredoc not tracked' });
    expect(stripProse('a.sh', source)).toEqual({ text: source, dropped: [] });
  });

  it('refuses a YAML block scalar instead of cutting the shell standing inside it', () => {
    const source = 'jobs:\n  run: |\n    echo hi # keep me\n';
    expect(readComments('a.yml', source)).toEqual({ lexed: false, reason: 'block scalar not tracked' });
    expect(stripProse('a.yml', source)).toEqual({ text: source, dropped: [] });
    expect(readComments('a.yml', 'a: |-\n  x\n')).toEqual({ lexed: false, reason: 'block scalar not tracked' });
    expect(readComments('a.yml', 'a: x | y\nb: c > d\n# why\n')).toMatchObject({ lexed: true });
  });

  it('reads a prefixed Python string as a string, not as code carrying a comment', () => {
    const source = 'print(f"a # b")\nx = rb\'c # d\'\n# why\n';
    const reading = readComments('a.py', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['# why']);
    expect(stripProse('a.py', source).text).toBe('print(f"a # b")\nx = rb\'c # d\'\n');
  });

  it('reads a shebang standing behind a byte-order mark', () => {
    const reading = readComments('a.sh', '\uFEFF#!/usr/bin/env bash\necho hi\n');
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => comment.kind)).toEqual(['directive']);
  });

  it('does not read inside an unquoted url()', () => {
    const source = '.a { background: url(http://x/*y*/z.png); }\n/* why */\n';
    const reading = readComments('a.css', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['/* why */']);
    expect(stripProse('a.css', source).text).toBe('.a { background: url(http://x/*y*/z.png); }\n');
  });

  it('lexes a script as JavaScript only where its type says JavaScript', () => {
    const foreign = '<script type="text/x-template">\n// template text, not a comment\n</script>\n';
    expect(readComments('a.svelte', foreign)).toEqual({ lexed: false, reason: 'foreign script type' });
    expect(stripProse('a.svelte', foreign)).toEqual({ text: foreign, dropped: [] });
    for (const open of ['<script>', '<script lang="ts">', '<script type="module">', '<script type="text/javascript">']) {
      expect(stripProse('a.svelte', `${open}\n// why\n</script>\n`).text).toBe(`${open}\n</script>\n`);
    }
  });

  it('reads past an attribute expression carrying a comment and an apostrophe', () => {
    const source = "<section class={[\n  // the tab strip's width\n  'a',\n]}>x</section>\n<!-- why -->\n";
    const reading = readComments('a.svelte', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['<!-- why -->']);
  });

  it('does not read a comment opener standing inside an attribute value', () => {
    const source = '<div title="a <!-- b"></div>\n<!-- why -->\n<p>x</p>\n';
    const reading = readComments('a.svelte', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => source.slice(comment.start, comment.end))).toEqual(['<!-- why -->']);
    expect(stripProse('a.svelte', source).text).toBe('<div title="a <!-- b"></div>\n<p>x</p>\n');
  });

  it('reads a Svelte file through its script, its style and its markup', () => {
    const source = '<script>\n// a\n</script>\n<!-- b -->\n<style>\n/* c */\n</style>\n';
    const reading = readComments('a.svelte', source);
    expect(reading.lexed).toBe(true);
    if (!reading.lexed) return;
    expect(reading.comments.map((comment) => [source.slice(comment.start, comment.end), comment.line])).toEqual([
      ['// a', 2],
      ['<!-- b -->', 4],
      ['/* c */', 6],
    ]);
  });
});
