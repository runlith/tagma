import type { CommentRange, Directive, Language, Unlexable } from '../language.js';
import { lineAt, lineStarts } from '../lines.js';
import { CSS_DIRECTIVES, cssComments } from './css.js';
import { JS_DIRECTIVES, jsComments } from './typescript.js';

const TAGS = ['script', 'style'] as const;
const AFTER_NAME = [' ', '\t', '\n', '\r', '>', '/'];
const LETTER = /[A-Za-z]/;
const SPACE = new Set([' ', '\t', '\n', '\r']);
const JS_TYPES = new Set([
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'text/typescript',
  'application/typescript',
]);

type Part = { readonly tag: (typeof TAGS)[number]; readonly attributes: string; readonly bodyAt: number };

function tagEnd(text: string, from: number): number | null {
  let quote = '';
  let braces = 0;
  let cursor = from;
  while (cursor < text.length) {
    const character = text[cursor]!;
    if (quote !== '') {
      if (braces > 0 && character === '\\') cursor += 2;
      else {
        if (character === quote) quote = '';
        cursor += 1;
      }
      continue;
    }
    if (braces > 0 && character === '/' && (text[cursor + 1] === '/' || text[cursor + 1] === '*')) {
      const line = text[cursor + 1] === '/';
      const close = line ? text.indexOf('\n', cursor) : text.indexOf('*/', cursor + 2);
      if (close === -1) return null;
      cursor = line ? close : close + 2;
      continue;
    }
    if (character === '"' || character === "'" || (braces > 0 && character === '`')) quote = character;
    else if (character === '{') braces += 1;
    else if (character === '}') braces = Math.max(0, braces - 1);
    else if (character === '>' && braces === 0) return cursor + 1;
    cursor += 1;
  }
  return null;
}

function attribute(attributes: string, name: string): string | null {
  let at = 0;
  while (at < attributes.length) {
    while (at < attributes.length && SPACE.has(attributes[at]!)) at += 1;
    const from = at;
    while (at < attributes.length && !SPACE.has(attributes[at]!) && attributes[at] !== '=') at += 1;
    const found = attributes.slice(from, at).toLowerCase();
    while (at < attributes.length && SPACE.has(attributes[at]!)) at += 1;
    if (attributes[at] !== '=') {
      if (found === name) return '';
      continue;
    }
    at += 1;
    while (at < attributes.length && SPACE.has(attributes[at]!)) at += 1;
    const quote = attributes[at];
    let value: string;
    if (quote === '"' || quote === "'") {
      const close = attributes.indexOf(quote, at + 1);
      value = close === -1 ? attributes.slice(at + 1) : attributes.slice(at + 1, close);
      at = close === -1 ? attributes.length : close + 1;
    } else {
      const valueAt = at;
      while (at < attributes.length && !SPACE.has(attributes[at]!)) at += 1;
      value = attributes.slice(valueAt, at);
    }
    if (found === name) return value;
  }
  return null;
}

function opening(text: string, at: number): Part | 'unterminated' | null {
  for (const tag of TAGS) {
    const head = `<${tag}`;
    if (text.slice(at, at + head.length).toLowerCase() !== head) continue;
    const after = text[at + head.length];
    if (after === undefined || !AFTER_NAME.includes(after)) continue;
    const shut = tagEnd(text, at + head.length);
    if (shut === null) return 'unterminated';
    return { tag, attributes: text.slice(at + head.length, shut - 1), bodyAt: shut };
  }
  return null;
}

function closing(text: string, tag: string, from: number): { readonly bodyEnd: number; readonly after: number } | null {
  const head = `</${tag}`;
  for (let at = text.indexOf('</', from); at !== -1; at = text.indexOf('</', at + 2)) {
    if (text.slice(at, at + head.length).toLowerCase() !== head) continue;
    const shut = text.indexOf('>', at + head.length);
    if (shut === -1) return null;
    if (text.slice(at + head.length, shut).trim() !== '') continue;
    return { bodyEnd: at, after: shut + 1 };
  }
  return null;
}

export function svelteComments(text: string): readonly CommentRange[] | Unlexable {
  const starts = lineStarts(text);
  const ranges: CommentRange[] = [];
  let at = 0;
  while (at < text.length) {
    if (text[at] !== '<') {
      at += 1;
      continue;
    }
    if (text.startsWith('<!--', at)) {
      const close = text.indexOf('-->', at + 4);
      if (close === -1) return { unlexable: 'unterminated comment' };
      ranges.push({ start: at, end: close + 3, line: lineAt(starts, at), text: text.slice(at + 4, close) });
      at = close + 3;
      continue;
    }
    const part = opening(text, at);
    if (part === 'unterminated') return { unlexable: 'unterminated element' };
    if (part === null) {
      const named = LETTER.test(text[at + 1] ?? '') || (text[at + 1] === '/' && LETTER.test(text[at + 2] ?? ''));
      if (!named) {
        at += 1;
        continue;
      }
      const past = tagEnd(text, at + 1);
      if (past === null) return { unlexable: 'unterminated tag' };
      at = past;
      continue;
    }
    if (part.tag === 'script') {
      const type = (attribute(part.attributes, 'type') ?? '').trim().toLowerCase();
      if (type !== '' && !JS_TYPES.has(type)) return { unlexable: 'foreign script type' };
    }
    const shut = closing(text, part.tag, part.bodyAt);
    if (shut === null) return { unlexable: `unterminated ${part.tag} element` };
    const read = part.tag === 'style' ? cssComments : jsComments;
    const inner = read(text.slice(part.bodyAt, shut.bodyEnd));
    if ('unlexable' in inner) return inner;
    for (const range of inner) {
      const start = range.start + part.bodyAt;
      ranges.push({ start, end: range.end + part.bodyAt, line: lineAt(starts, start), text: range.text });
    }
    at = shut.after;
  }
  return ranges;
}

const SVELTE_DIRECTIVES: readonly Directive[] = [...JS_DIRECTIVES, ...CSS_DIRECTIVES].filter(
  (row, index, rows) => rows.findIndex((other) => other.opens === row.opens && other.side === row.side) === index,
);

export const svelte: Language = {
  name: 'svelte',
  extensions: ['.svelte', '.html'],
  comments: svelteComments,
  directives: SVELTE_DIRECTIVES,
  marker: { line: '//', block: { open: '<!--', close: '-->' } },
  continuation: '*',
};
