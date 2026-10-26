import { UnsupportedSource } from '../../imports';

export type Token = {
  readonly kind: 'name' | 'string' | 'number' | 'op';
  readonly text: string;
  readonly value?: string;
  readonly expressions?: readonly string[];
  readonly line: number;
  readonly start: number;
  readonly end: number;
};

export type Logical = { readonly tokens: readonly Token[]; readonly indent: number };

const NAME_START = /[\p{L}\p{Nl}_]/u;
const NAME_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}_]/u;
const PREFIX = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/;
const OPENING = new Set(['(', '[', '{']);
const CLOSING = new Set([')', ']', '}']);
const PAIRS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

type Read = { readonly stop: number; readonly value?: string; readonly expressions?: readonly string[] };

export function logicalLines(source: string, path: string): readonly Logical[] {
  const lines: Logical[] = [];
  let at = 0;
  let line = 1;
  const opened: string[] = [];
  let tokens: Token[] = [];
  let indent = 0;
  let fresh = true;
  const fail = (why: string, where = line): never => {
    throw new UnsupportedSource(path, `does not parse at line ${where}: ${why}`);
  };
  const end = (): void => {
    if (tokens.length > 0) lines.push({ tokens, indent });
    tokens = [];
    fresh = true;
  };
  const stringAt = (from: number, prefix: string, startLine: number): Read => {
    const quote = source[from] as string;
    const triple = source.startsWith(quote.repeat(3), from);
    const close = triple ? quote.repeat(3) : quote;
    const formatted = /[fF]/.test(prefix);
    const plain = !formatted && !/[bB]/.test(prefix);
    const expressions: string[] = [];
    let cursor = from + close.length;
    let escaped = false;
    for (;;) {
      if (cursor >= source.length) return fail('a string is never closed', startLine);
      const char = source[cursor] as string;
      if (char === '\\') {
        escaped = true;
        if (source[cursor + 1] === '\n') line += 1;
        cursor += 2;
        continue;
      }
      if (char === '\n') {
        if (!triple) return fail('a string is never closed', startLine);
        line += 1;
      }
      if (source.startsWith(close, cursor)) {
        const content = source.slice(from + close.length, cursor);
        return {
          stop: cursor + close.length,
          value: plain && !escaped ? content : undefined,
          expressions: expressions.length === 0 ? undefined : expressions,
        };
      }
      if (formatted && char === '{') {
        if (source[cursor + 1] === '{') {
          cursor += 2;
          continue;
        }
        const stop = expressionEnd(cursor + 1, startLine);
        expressions.push(source.slice(cursor + 1, stop - 1));
        cursor = stop;
        continue;
      }
      cursor += 1;
    }
  };
  const expressionEnd = (from: number, startLine: number): number => {
    let nested = 0;
    let cursor = from;
    while (cursor < source.length) {
      const char = source[cursor] as string;
      if (char === '\n') line += 1;
      if (char === "'" || char === '"') {
        cursor = stringAt(cursor, '', startLine).stop;
        continue;
      }
      if (OPENING.has(char)) nested += 1;
      else if (CLOSING.has(char)) {
        if (char === '}' && nested === 0) return cursor + 1;
        nested -= 1;
      }
      cursor += 1;
    }
    return fail('a formatted string is never closed', startLine);
  };
  while (at < source.length) {
    if (fresh && opened.length === 0) {
      let width = 0;
      let cursor = at;
      while (source[cursor] === ' ' || source[cursor] === '\t' || source[cursor] === '\f') {
        width = source[cursor] === '\t' ? (Math.floor(width / 8) + 1) * 8 : source[cursor] === ' ' ? width + 1 : 0;
        cursor += 1;
      }
      indent = width;
      at = cursor;
      fresh = false;
    }
    const char = source[at] as string;
    if (char === '\n') {
      line += 1;
      at += 1;
      if (opened.length === 0) end();
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\r' || char === '\f') {
      at += 1;
      continue;
    }
    if (char === '#') {
      const stop = source.indexOf('\n', at);
      at = stop === -1 ? source.length : stop;
      continue;
    }
    if (char === '\\') {
      const next = source[at + 1] === '\r' ? source[at + 2] : source[at + 1];
      if (next !== '\n' && next !== undefined) fail('a backslash outside a string continues no line');
      at += source[at + 1] === '\r' ? 3 : 2;
      line += 1;
      continue;
    }
    const startLine = line;
    const string = (from: number, prefix: string): void => {
      const { stop, value, expressions } = stringAt(from, prefix, startLine);
      tokens.push({
        kind: 'string',
        text: source.slice(at, stop),
        value,
        expressions,
        line: startLine,
        start: at,
        end: stop,
      });
      at = stop;
    };
    if (char === "'" || char === '"') {
      string(at, '');
      continue;
    }
    if (NAME_START.test(char)) {
      let stop = at + 1;
      while (stop < source.length && NAME_PART.test(source[stop] as string)) stop += 1;
      const word = source.slice(at, stop);
      if (PREFIX.test(word) && (source[stop] === "'" || source[stop] === '"')) {
        string(stop, word);
        continue;
      }
      tokens.push({ kind: 'name', text: word, line: startLine, start: at, end: stop });
      at = stop;
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[at + 1] ?? ''))) {
      let stop = at + 1;
      for (;;) {
        const next = source[stop];
        const signed = (next === '+' || next === '-') && /[eE]/.test(source[stop - 1] as string) && !/^0[xX]/.test(source.slice(at, stop));
        if (next === undefined || (!/[0-9A-Za-z_.]/.test(next) && !signed)) break;
        stop += 1;
      }
      tokens.push({ kind: 'number', text: source.slice(at, stop), line: startLine, start: at, end: stop });
      at = stop;
      continue;
    }
    if (OPENING.has(char)) opened.push(char);
    else if (CLOSING.has(char)) {
      const open = opened.pop();
      if (open === undefined) fail(`\`${char}\` closes nothing`);
      if (open !== PAIRS[char]) fail(`\`${char}\` closes \`${open}\``);
    }
    tokens.push({ kind: 'op', text: char, line: startLine, start: at, end: at + 1 });
    at += 1;
  }
  if (opened.length > 0) fail('a bracket is never closed');
  end();
  return lines;
}
