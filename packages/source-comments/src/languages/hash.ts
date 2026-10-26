import type { CommentRange, Directive, Language, Unlexable } from '../language.js';
import { lineAt, lineStarts } from '../lines.js';

export const HASH_DIRECTIVES: readonly Directive[] = [
  { opens: '#!', side: 'content' },
  { opens: 'prettier-ignore', side: 'content' },
  { opens: 'biome-ignore', side: 'content' },
  { opens: '@license', side: 'content' },
  { opens: '@preserve', side: 'content' },
];

const BOM = '\uFEFF';
const BLANK = [' ', '\t', '\n', '\r'];
const BEFORE_COMMENT = new Set([...BLANK, BOM]);
const BEFORE_QUOTE = new Set([...BLANK, BOM, '=', ':', '(', '[', '{', ',']);
const PREFIXES = new Set(['b', 'br', 'f', 'fr', 'r', 'rb', 'rf', 'u']);
const LETTER = /[A-Za-z]/;

function prefixed(text: string, at: number): boolean {
  let start = at;
  while (start > 0 && LETTER.test(text[start - 1]!)) start -= 1;
  if (start === at) return false;
  if (!PREFIXES.has(text.slice(start, at).toLowerCase())) return false;
  return BEFORE_QUOTE.has(start === 0 ? '\n' : text[start - 1]!);
}

function blockScalar(text: string, at: number): boolean {
  let cursor = at + 1;
  while (cursor < text.length) {
    const character = text[cursor]!;
    if (character !== '+' && character !== '-' && (character < '0' || character > '9')) break;
    cursor += 1;
  }
  while (text[cursor] === ' ' || text[cursor] === '\t') cursor += 1;
  return cursor >= text.length || text[cursor] === '\n' || text[cursor] === '\r';
}

function stringEnd(text: string, at: number, quote: string): number {
  if (text.startsWith(quote.repeat(3), at)) {
    const close = text.indexOf(quote.repeat(3), at + 3);
    return close === -1 ? -1 : close + 3;
  }
  if (quote === "'") {
    const close = text.indexOf(quote, at + 1);
    return close === -1 ? -1 : close + 1;
  }
  let cursor = at + 1;
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (text[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return -1;
}

export function hashComments(text: string): readonly CommentRange[] | Unlexable {
  const starts = lineStarts(text);
  const ranges: CommentRange[] = [];
  const opensFile = text.startsWith(BOM) ? 1 : 0;
  let at = 0;
  while (at < text.length) {
    const character = text[at]!;
    const before = at === 0 ? '\n' : text[at - 1]!;
    if (character === '#' && BEFORE_COMMENT.has(before)) {
      const broke = text.indexOf('\n', at);
      const end = broke === -1 ? text.length : broke;
      const shebang = at === opensFile && text[at + 1] === '!';
      ranges.push({
        start: at,
        end,
        line: lineAt(starts, at),
        text: shebang ? text.slice(at, end) : text.slice(at + 1, end),
      });
      at = end;
      continue;
    }
    if (character === '<' && text[at + 1] === '<') return { unlexable: 'heredoc not tracked' };
    if ((character === '|' || character === '>') && blockScalar(text, at)) {
      return { unlexable: 'block scalar not tracked' };
    }
    if ((character === '"' || character === "'") && (BEFORE_QUOTE.has(before) || prefixed(text, at))) {
      const end = stringEnd(text, at, character);
      if (end === -1) return { unlexable: 'unterminated string literal' };
      at = end;
      continue;
    }
    at += 1;
  }
  return ranges;
}

export const hash: Language = {
  name: 'hash',
  extensions: ['.sh', '.zsh', '.yml', '.yaml', '.toml', '.py', 'Dockerfile'],
  comments: hashComments,
  directives: HASH_DIRECTIVES,
  marker: { line: '#' },
};
