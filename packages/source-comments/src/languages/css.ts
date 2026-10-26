import type { CommentRange, Directive, Language, Unlexable } from '../language.js';
import { lineAt, lineStarts } from '../lines.js';

export const CSS_DIRECTIVES: readonly Directive[] = [
  { opens: 'sourceMappingURL=', side: 'content' },
  { opens: '/*# sourceMappingURL=', side: 'raw' },
  { opens: '/*#sourceMappingURL=', side: 'raw' },
  { opens: '@license', side: 'content' },
  { opens: '@preserve', side: 'content' },
  { opens: 'prettier-ignore', side: 'content' },
  { opens: 'biome-ignore', side: 'content' },
];

const NAME = /[A-Za-z0-9_\-\\]/;
const SPACE = new Set([' ', '\t', '\n', '\r', '\f']);

function urlEnd(text: string, at: number): number | 'unterminated' | null {
  if (text.slice(at, at + 4).toLowerCase() !== 'url(') return null;
  if (at > 0 && NAME.test(text[at - 1]!)) return null;
  let cursor = at + 4;
  while (cursor < text.length && SPACE.has(text[cursor]!)) cursor += 1;
  if (text[cursor] === '"' || text[cursor] === "'") return null;
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (text[cursor] === ')') return cursor + 1;
    cursor += 1;
  }
  return 'unterminated';
}

export function cssComments(text: string): readonly CommentRange[] | Unlexable {
  const starts = lineStarts(text);
  const ranges: CommentRange[] = [];
  let at = 0;
  while (at < text.length) {
    const character = text[at]!;
    if (character === 'u' || character === 'U') {
      const url = urlEnd(text, at);
      if (url === 'unterminated') return { unlexable: 'unterminated url' };
      if (url !== null) {
        at = url;
        continue;
      }
    }
    if (character === '/' && text[at + 1] === '*') {
      const close = text.indexOf('*/', at + 2);
      if (close === -1) return { unlexable: 'unterminated comment' };
      ranges.push({ start: at, end: close + 2, line: lineAt(starts, at), text: text.slice(at + 2, close) });
      at = close + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      let cursor = at + 1;
      while (cursor < text.length && text[cursor] !== character && text[cursor] !== '\n') {
        cursor += text[cursor] === '\\' ? 2 : 1;
      }
      if (text[cursor] !== character) return { unlexable: 'unterminated string literal' };
      at = cursor + 1;
      continue;
    }
    at += 1;
  }
  return ranges;
}

export const css: Language = {
  name: 'css',
  extensions: ['.css', '.scss'],
  comments: cssComments,
  directives: CSS_DIRECTIVES,
  marker: { block: { open: '/*', close: '*/' } },
};
