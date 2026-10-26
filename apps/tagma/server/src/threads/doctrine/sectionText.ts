import { basename } from 'node:path';

const SECTION = /^export const [A-Za-z]\w*: Section =/m;

const TERMINAL_VERB = /\btagma +(?!op\b)[a-z][\w-]*/g;

const SNAKE = /\b[a-z]+(?:_[a-z]+)+\b/g;
const VOCABULARY = new Set(['in_work']);

const UNEXPANDED = /\{\{[^{}]*\}\}/g;

const OWN = new Set(['sectionText.ts', 'sectionText.test.ts']);

export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly term: string;
  readonly instead: string;
}

interface LiteralPart {
  readonly text: string;
  readonly line: number;
}

function literalParts(source: string): LiteralPart[] {
  const parts: LiteralPart[] = [];
  const frames: { kind: 'template' | 'expression'; braces: number }[] = [];
  let buffer = '';
  let start = 1;
  let line = 1;
  let cursor = 0;
  const flush = () => {
    if (buffer.length > 0) parts.push({ text: buffer, line: start });
    buffer = '';
  };
  while (cursor < source.length) {
    const char = source[cursor]!;
    const next = source[cursor + 1];
    const frame = frames.at(-1);
    if (frame?.kind === 'template') {
      if (char === '\\') {
        if (buffer.length === 0) start = line;
        buffer += source.slice(cursor, cursor + 2);
        if (next === '\n') line += 1;
        cursor += 2;
        continue;
      }
      if (char === '`') {
        flush();
        frames.pop();
        cursor += 1;
        continue;
      }
      if (char === '$' && next === '{') {
        flush();
        frames.push({ kind: 'expression', braces: 0 });
        cursor += 2;
        continue;
      }
      if (buffer.length === 0) start = line;
      buffer += char;
      if (char === '\n') line += 1;
      cursor += 1;
      continue;
    }
    if (char === '\n') {
      line += 1;
      cursor += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      cursor += 2;
      while (cursor < source.length && !(source[cursor] === '*' && source[cursor + 1] === '/')) {
        if (source[cursor] === '\n') line += 1;
        cursor += 1;
      }
      cursor += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      cursor += 1;
      while (cursor < source.length && source[cursor] !== char) {
        if (source[cursor] === '\\') cursor += 1;
        if (source[cursor] === '\n') line += 1;
        cursor += 1;
      }
      cursor += 1;
      continue;
    }
    if (char === '`') {
      frames.push({ kind: 'template', braces: 0 });
      cursor += 1;
      continue;
    }
    if (frame?.kind === 'expression') {
      if (char === '{') frame.braces += 1;
      else if (char === '}') {
        if (frame.braces === 0) frames.pop();
        else frame.braces -= 1;
      }
    }
    cursor += 1;
  }
  flush();
  return parts;
}

export function skipped(path: string): boolean {
  return OWN.has(basename(path));
}

export function detect(path: string, text: string): Finding[] {
  if (!SECTION.test(text)) return [];
  const findings: Finding[] = [];
  for (const part of literalParts(text)) {
    part.text.split('\n').forEach((prose, index) => {
      const line = part.line + index;
      for (const [term] of prose.matchAll(TERMINAL_VERB)) {
        findings.push({ path, line, term, instead: "the operation's id through ctx.op, or `tagma op <id>`" });
      }
      for (const [term] of prose.matchAll(SNAKE)) {
        if (VOCABULARY.has(term)) continue;
        findings.push({
          path,
          line,
          term,
          instead: `\${ctx.op('${term}')} for an operation, this scan's VOCABULARY for a word of the graph's own, and otherwise a sentence that does not spell it`,
        });
      }
      for (const [term] of prose.matchAll(UNEXPANDED)) {
        findings.push({ path, line, term, instead: 'the value as `${ctx.…}`; nothing expands a double brace' });
      }
    });
  }
  return findings;
}
