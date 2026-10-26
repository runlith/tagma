import { isFileMarker, kindOf, type CommentKind } from './classify.js';
import type { CommentRange, Language, Unlexable } from './language.js';
import { LANGUAGES, languageOf } from './languages/index.js';
import { lineAt, lineStarts } from './lines.js';

export const COMMENT_POLICIES = ['allowed', 'forbid'] as const;
export type CommentPolicy = (typeof COMMENT_POLICIES)[number];

export type Comment = {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly kind: CommentKind;
};

export type Reading =
  | { readonly lexed: true; readonly exempt: boolean; readonly comments: readonly Comment[] }
  | { readonly lexed: false; readonly reason: string };

export type Dropped = { readonly line: number; readonly head: string };

export type Stripped = { readonly text: string; readonly dropped: readonly Dropped[] };

const HEAD_LIMIT = 120;

type Classified = { readonly range: CommentRange; readonly kind: CommentKind };

type Classification = { readonly comments: readonly Classified[]; readonly exempt: boolean };

function ordered(ranges: readonly CommentRange[], length: number): boolean {
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor || range.end < range.start || range.end > length) return false;
    cursor = range.end;
  }
  return true;
}

function classify(language: Language, text: string): Classification | Unlexable {
  const found = language.comments(text);
  if ('unlexable' in found) return found;
  if (!ordered(found, text.length)) return { unlexable: 'comment ranges out of order' };
  const starts = lineStarts(text);
  const kinds = found.map((range) => kindOf(language, range, text.slice(range.start, range.end)));
  const single = found.map((range, index) => kinds[index] === 'marked' && lastLineOf(starts, range) === range.line);
  const comments = found.map((range, index) => ({
    range,
    kind: kinds[index] === 'marked' && !standsAlone(found, single, starts, index) ? 'prose' : (kinds[index] as CommentKind),
  }));
  const first = found[0];
  const exempt = first !== undefined && isFileMarker(language.marker, text.slice(first.start, first.end));
  return { comments, exempt };
}

const lastLineOf = (starts: readonly number[], range: CommentRange): number => lineAt(starts, Math.max(range.start, range.end - 1));

function standsAlone(found: readonly CommentRange[], single: readonly boolean[], starts: readonly number[], index: number): boolean {
  if (!single[index]) return false;
  const range = found[index] as CommentRange;
  const before = found[index - 1];
  if (before !== undefined && single[index - 1] && lastLineOf(starts, before) + 1 === range.line) return false;
  const after = found[index + 1];
  if (after !== undefined && single[index + 1] && after.line === range.line + 1) return false;
  return true;
}

export function readComments(path: string, text: string, languages: readonly Language[] = LANGUAGES): Reading {
  const language = languageOf(path, languages);
  if (language === null) return { lexed: false, reason: 'unknown language' };
  const read = classify(language, text);
  if ('unlexable' in read) return { lexed: false, reason: read.unlexable };
  return {
    lexed: true,
    exempt: read.exempt,
    comments: read.comments.map(({ range, kind }) => ({
      start: range.start,
      end: range.end,
      line: range.line,
      kind,
    })),
  };
}

export function stripProse(path: string, text: string, within?: ReadonlySet<number>, languages: readonly Language[] = LANGUAGES): Stripped {
  const language = languageOf(path, languages);
  if (language === null) return { text, dropped: [] };
  const read = classify(language, text);
  if ('unlexable' in read || read.exempt) return { text, dropped: [] };
  const starts = lineStarts(text);
  const going: CommentRange[] = [];
  let run: CommentRange[] = [];
  const finish = (): void => {
    if (run.some((range) => covered(starts, range, within))) {
      for (const range of run) going.push(range);
    }
    run = [];
  };
  for (const entry of read.comments) {
    if (entry.kind !== 'prose') {
      finish();
      continue;
    }
    const previous = run[run.length - 1];
    if (previous !== undefined && !adjacentLines(text, starts, language, previous, entry.range)) finish();
    run.push(entry.range);
  }
  finish();
  if (going.length === 0) return { text, dropped: [] };
  return {
    text: emptied(text, going),
    dropped: going.map((range) => ({ line: range.line, head: head(range.text) })),
  };
}

function adjacentLines(
  text: string,
  starts: readonly number[],
  language: Language,
  previous: CommentRange,
  current: CommentRange,
): boolean {
  const opener = language.marker.line;
  const alone = (range: CommentRange): boolean => {
    if (opener === undefined || !text.startsWith(opener, range.start)) return false;
    const start = starts[range.line - 1] as number;
    const end = starts[range.line] ?? text.length;
    return text.slice(start, range.start).trim() === '' && text.slice(range.end, end).trim() === '';
  };
  return current.line === previous.line + 1 && alone(previous) && alone(current);
}

function covered(starts: readonly number[], range: CommentRange, within: ReadonlySet<number> | undefined): boolean {
  if (within === undefined) return true;
  const last = lineAt(starts, Math.max(range.start, range.end - 1));
  for (let line = range.line; line <= last; line += 1) if (!within.has(line)) return false;
  return true;
}

function head(content: string): string {
  const first = content.split('\n').find((line) => line.trim() !== '') ?? '';
  const only = first.trim();
  return only.length > HEAD_LIMIT ? only.slice(0, HEAD_LIMIT) : only;
}

const IDENTITY_SOURCES: readonly (readonly [string, string])[] = [
  ['a.ts', 'const a = 1; // why\n/*! keep */\n/* drop */\nconst s = `${a}`;\n//! run\n//! run two\n'],
  [
    'b.ts',
    [
      '#!/usr/bin/env bun',
      'const half = a! / 2; // after an assertion',
      'const chain = f()! / g[0]! / 3 / 4; /* two divisions */',
      "const text = 'x'! / 1, count = 2! / 1, twice = a!! / 2;",
      'const back = typeof a! / 2 /* not an assertion */ / 1;',
      'const pattern = /\\/\\/ not a comment/g, other = /[/*]/;',
      'const quote = "// not" + \'/* not */\';',
      'const nested = `a ${`b ${c /* inside */} // not`} /* not */`;',
      'const ratio = (a) / 2 / (b); // why',
      '// @ts-expect-error',
      '/** \n * @param x the value\n */',
      '/// <reference path="x" />',
      '//# sourceMappingURL=a.js.map',
      'class K {\n  m(x: number) { // member\n    return x;\n  }\n}',
      '',
    ].join('\n'),
  ],
  ['c.ts', '//! comments\n// kept whole\n'],
  ['d.ts', 'const open = "never closed\n'],
  ['e.ts', 'const bad = a! / 2 / (\n'],
  ['a.md', '# One\n\ntext\n<!-- why -->\n'],
  [
    'a.css',
    '.a { content: "/* not */"; }\n/* why */\n/*! keep */\n.b { background: url(//x/y.png); }\n.c { background: url("/*.png"); }\n',
  ],
  ['b.css', '.a { content: "open; }\n'],
  [
    'a.svelte',
    '<script lang="ts">\n// a\n</script>\n<!-- b -->\n<div title={"// not"} on:click={() => x /* c */ > 1}>{a > b}</div>\n<style>\n/* c */\n</style>\n',
  ],
  ['b.svelte', '<script type="text/x-template">\n// a\n</script>\n'],
  ['c.svelte', '<!-- open\n'],
  ['a.sh', '#!/usr/bin/env bash\necho "a # not"\n# why\necho a#b \'# not\' "\\"# not"\n'],
  ['b.sh', 'cat <<EOF\n# body\nEOF\n'],
  ['a.py', 'x = """\n# not a comment\n"""\n# why\ny = f"#{x}"  # why\nz = rb\'# not\'\n'],
  ['b.py', 'x = "open\n'],
  ['a.yml', 'jobs:\n  run: |\n    echo hi # keep me\n'],
  ['b.yml', 'a: 1 # why\nb: "# not"\n'],
  ['Dockerfile', 'FROM x\n# why\n'],
];

export const readingAnswers = (languages: readonly Language[]): readonly string[] =>
  IDENTITY_SOURCES.flatMap(([path, text]) => [
    JSON.stringify(readComments(path, text, languages)),
    JSON.stringify(stripProse(path, text, undefined, languages)),
  ]);

export const READING_ANSWERS: readonly string[] = readingAnswers(LANGUAGES);

function emptied(text: string, going: readonly CommentRange[]): string {
  const pieces: string[] = [];
  const cuts: number[] = [];
  let cursor = 0;
  let carried = 0;
  for (const range of going) {
    pieces.push(text.slice(cursor, range.start));
    carried += range.start - cursor;
    cuts.push(carried);
    cursor = range.end;
  }
  pieces.push(text.slice(cursor));
  const spliced = pieces.join('');
  const starts = lineStarts(spliced);
  const touched = new Set(cuts.map((cut) => lineAt(starts, Math.min(cut, Math.max(0, spliced.length - 1)))));
  const kept: string[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const whole = spliced.slice(starts[index]!, starts[index + 1] ?? spliced.length);
    if (!touched.has(index + 1)) {
      kept.push(whole);
      continue;
    }
    const breaks = whole.endsWith('\r\n') ? 2 : whole.endsWith('\n') ? 1 : 0;
    const content = whole.slice(0, whole.length - breaks);
    if (content.trim() === '') continue;
    kept.push(content.replace(/[ \t]+$/, '') + whole.slice(whole.length - breaks));
  }
  return kept.join('');
}
