import { describe, expect, test } from 'bun:test';
import type { LineEdit } from '@runlith/files/lines';
import { highlightLines } from './colours';
import { type DocumentColours, TokenDocument } from './document';
import { type LineTokenizer, lineTokenizerFor } from './grammar';

const real = (await lineTokenizerFor('typescript')) as LineTokenizer;

type Counted = LineTokenizer & { tokenized: number };

function counting(inner: LineTokenizer): Counted {
  const counted: Counted = {
    tokenized: 0,
    initial: inner.initial,
    line(body, from) {
      counted.tokenized += 1;
      return inner.line(body, from);
    },
    advance(body, from) {
      counted.tokenized += 1;
      return inner.advance(body, from);
    },
  };
  return counted;
}

function codeLines(count: number): string[] {
  return Array.from({ length: count }, (_, at) => `const value${at} = ${at};`);
}

function settle(document: TokenDocument): DocumentColours[] {
  const chunks: DocumentColours[] = [];
  while (document.busy) {
    const chunk = document.step();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function opened(lines: readonly string[], tokenizer: LineTokenizer = real): TokenDocument {
  const document = new TokenDocument(tokenizer, lines.join('\n'), 1);
  document.viewport(0, lines.length);
  settle(document);
  return document;
}

function colouredAll(document: TokenDocument, count: number): Map<number, NonNullable<DocumentColours['lines'][number]>> {
  document.viewport(0, count);
  const coloured = new Map<number, NonNullable<DocumentColours['lines'][number]>>();
  for (const chunk of settle(document)) {
    chunk.lines.forEach((tokens, at) => {
      if (tokens !== null) coloured.set(chunk.from + at, tokens);
    });
  }
  return coloured;
}

const replace = (lines: string[], edit: LineEdit): string[] => [...lines.slice(0, edit.from), ...edit.lines, ...lines.slice(edit.to)];

describe('a session recolours from the touched line until the state converges', () => {
  test('a one-line edit converges without tokenizing the unchanged tail', () => {
    const counted = counting(real);
    const document = opened(codeLines(12), counted);
    counted.tokenized = 0;

    document.edit(2, [{ from: 5, to: 6, lines: ['const edited = "text";'] }]);
    const chunks = settle(document);

    expect(counted.tokenized).toBeLessThanOrEqual(3);
    expect(chunks.at(-1)?.settled).toBe(true);
    expect(chunks[0]?.version).toBe(2);
  });

  test('carries an opened comment to the end of the file, or to the line that closes it', () => {
    const counted = counting(real);
    const unclosed = opened(codeLines(12), counted);
    counted.tokenized = 0;
    unclosed.edit(2, [{ from: 0, to: 0, lines: ['/*'] }]);
    settle(unclosed);
    expect(counted.tokenized).toBeGreaterThanOrEqual(12);

    const closed = opened([...codeLines(6), '*/', ...codeLines(6)], counted);
    counted.tokenized = 0;
    closed.edit(2, [{ from: 0, to: 0, lines: ['/*'] }]);
    settle(closed);
    expect(counted.tokenized).toBeGreaterThan(6);
    expect(counted.tokenized).toBeLessThanOrEqual(11);

    counted.tokenized = 0;
    closed.edit(3, [{ from: 0, to: 1, lines: [] }]);
    settle(closed);
    expect(counted.tokenized).toBeLessThanOrEqual(11);
  });

  test('colours the document exactly as the whole text is coloured after a series of edits', async () => {
    let lines = [...codeLines(20), '/* a block', 'comment */', ...codeLines(10)];
    const document = opened(lines);
    const series: LineEdit[][] = [
      [{ from: 5, to: 7, lines: ['/* opens', 'const inside = 1;'] }],
      [{ from: 0, to: 1, lines: [] }],
      [
        { from: 3, to: 3, lines: ['const a = 1;', 'const b = `template'] },
        { from: 15, to: 16, lines: ['still template`;'] },
      ],
      [{ from: 30, to: 31, lines: ['}', '', 'const last = 2;'] }],
    ];
    let version = 1;
    for (const edits of series) {
      version += 1;
      expect(document.edit(version, edits)).toBeUndefined();
      for (const edit of [...edits].reverse()) lines = replace(lines, edit);
      settle(document);
    }

    expect(colouredAll(document, lines.length)).toEqual(await highlightLines(lines.join('\n'), 'typescript'));
  });

  test('never calls the unwalked tail verified when an edit converges before the first pass ended', async () => {
    let lines = [...codeLines(402), '/* opened below the first pass', ...codeLines(2)];
    const document = new TokenDocument(real, lines.join('\n'), 1);
    document.step();
    expect(document.busy).toBe(true);
    const edit: LineEdit = { from: 10, to: 11, lines: ['const other = 1;'] };
    document.edit(2, [edit]);
    lines = replace(lines, edit);
    settle(document);

    expect(colouredAll(document, lines.length)).toEqual(await highlightLines(lines.join('\n'), 'typescript'));
  });

  test('answers a requested window even when the pass converges before reaching it', () => {
    const document = new TokenDocument(real, codeLines(12).join('\n'), 1);
    document.step();
    document.edit(2, [{ from: 5, to: 6, lines: ['const other = 1;'] }]);
    document.viewport(9, 11);
    const delivered = new Set(
      settle(document).flatMap((chunk) => Array.from({ length: chunk.to - chunk.from }, (_, at) => chunk.from + at)),
    );

    expect([...delivered].sort((a, b) => a - b)).toEqual([9, 10]);
  });

  test('refuses a batch whose ranges overlap or leave the document, and keeps the document as it was', async () => {
    const lines = codeLines(4);
    const document = opened(lines);

    expect(
      document.edit(2, [
        { from: 1, to: 3, lines: [] },
        { from: 2, to: 3, lines: ['x'] },
      ]),
    ).toBe('order');
    expect(document.edit(3, [{ from: 3, to: 5, lines: [] }])).toBe('range');

    expect(colouredAll(document, lines.length)).toEqual(await highlightLines(lines.join('\n'), 'typescript'));
  });

  test('cuts lines the way the whole-text path does, so CRLF text colours alike', async () => {
    const text = codeLines(3).join('\r\n');
    const document = new TokenDocument(real, text, 1);

    expect(colouredAll(document, 3)).toEqual(await highlightLines(text, 'typescript'));
  });
});

describe('a session reads embedded languages', () => {
  test('colours the script and the style of a svelte file, and a fenced block of a markdown file', async () => {
    const svelte = (await lineTokenizerFor('svelte')) as LineTokenizer;
    const component = ['<script lang="ts">', '  const x: number = 1;', '</script>', '<style>', '  a { color: red; }', '</style>'];
    const painted = colouredAll(new TokenDocument(svelte, component.join('\n'), 1), component.length);
    expect(new Set(painted.get(1)?.map((token) => token.color)).size).toBeGreaterThan(2);
    expect(new Set(painted.get(4)?.map((token) => token.color)).size).toBeGreaterThan(2);

    const markdown = (await lineTokenizerFor('markdown')) as LineTokenizer;
    const fenced = ['```ts', 'const x: number = 1;', '```'];
    const inFence = colouredAll(new TokenDocument(markdown, fenced.join('\n'), 1), fenced.length);
    expect(inFence.get(1)?.length).toBeGreaterThan(1);
  });

  test('has no grammar for plain text or ansi, and says so', async () => {
    expect(await lineTokenizerFor('text')).toBeUndefined();
    expect(await lineTokenizerFor('ansi')).toBeUndefined();
    expect(await lineTokenizerFor('brainfuck')).toBeUndefined();
  });
});
