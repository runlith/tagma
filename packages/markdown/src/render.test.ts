import { describe, expect, test } from 'bun:test';
import type { Tokens } from 'marked';
import { createMarkdownParser, type MarkdownHtml, MarkdownRenderer } from './render';

const BRACKET = /\[\[[0-9a-f]{8}(?:\|[^\]\n]+)?\]\]/g;

function cells(source: string, atoms: readonly RegExp[]): string[][] {
  const table = createMarkdownParser([], atoms).lexer(source)[0] as Tokens.Table;
  return table.rows.map((row) => row.map((cell) => cell.text));
}

function blocks(source: string, atoms: readonly RegExp[]): { type: string; raw: string }[] {
  return createMarkdownParser([], atoms)
    .lexer(source)
    .map(({ type, raw }) => ({ type, raw }));
}

function table(...rows: string[]): string {
  return `| one | two |\n| --- | --- |\n${rows.join('\n')}\n`;
}

describe('a body rendered while it streams', () => {
  test('keeps every settled block as the same value, keyed by where it starts', async () => {
    const renderer = new MarkdownRenderer();
    const first = renderer.render({ text: 'One.\n\nTwo.\n\nThr', key: 'k', streaming: true });
    const later = renderer.render({ text: 'One.\n\nTwo.\n\nThree.\n\nFo', key: 'k', streaming: true });

    expect(later.map((block) => block.key)).toEqual(['0', '6', '12', '20']);
    expect(later[0]).toBe(first[0] as MarkdownHtml);
    expect(later[1]).toBe(first[1] as MarkdownHtml);
  });

  test('finishes as the same blocks, with only the tail painted again and no block left live', async () => {
    const renderer = new MarkdownRenderer();
    const streamed = renderer.render({ text: 'One.\n\nTw', key: 'k', streaming: true });
    const finished = renderer.render({ text: 'One.\n\nTwo.', key: 'k', streaming: false });

    expect(streamed.map((block) => block.live)).toEqual([false, true]);
    expect(finished.map((block) => [block.key, block.live])).toEqual([
      ['0', false],
      ['6', false],
    ]);
    expect(finished[0]).toBe(streamed[0] as MarkdownHtml);
  });

  test('keeps a paragraph that may still take the next line live until it settles', async () => {
    const renderer = new MarkdownRenderer();
    const held = renderer.render({ text: 'Use `` then `a`\n#', key: 'k', streaming: true });
    const settled = renderer.render({ text: 'Use `` then `a`\n# Head\n\nNext', key: 'k', streaming: true });

    expect(held.map((block) => block.live)).toEqual([true, true]);
    expect(settled.map((block) => block.live)).toEqual([false, false, true]);
  });
});

test('a link text is inline markdown, escaped like any other text', async () => {
  const html = await createMarkdownParser().parse('[**жирный** и a < b](https://example.com)');
  expect(html).toContain('rel="noopener noreferrer"><strong>жирный</strong> и a &lt; b</a>');
});

describe('a table row and the atoms a product declared', () => {
  test('splits between the atoms and never through one', () => {
    expect(cells(table('| x | [[5b386d76|Один durable inbox треда]] |'), [BRACKET])).toEqual([
      ['x', '[[5b386d76|Один durable inbox треда]]'],
    ]);
  });

  test('splits through the same row when nothing was declared', () => {
    expect(cells(table('| x | [[5b386d76|Один durable inbox треда]] |'), [])).toEqual([['x', '[[5b386d76']]);
  });

  test('keeps every atom of a row whole, not only the first', () => {
    expect(cells(table('| [[5b386d76|первый]] | [[6a38a79f|второй]] |'), [BRACKET])).toEqual([
      ['[[5b386d76|первый]]', '[[6a38a79f|второй]]'],
    ]);
  });

  test('keeps an atom whole in every row of the table', () => {
    expect(cells(table('| a | [[5b386d76|один]] |', '| b | [[6a38a79f|два]] |'), [BRACKET])).toEqual([
      ['a', '[[5b386d76|один]]'],
      ['b', '[[6a38a79f|два]]'],
    ]);
  });

  test('leaves the block under the table starting where it started', () => {
    expect(blocks(`${table('| x | [[5b386d76|подпись]] |')}\nprose under it\n`, [BRACKET])).toEqual([
      { type: 'table', raw: '| one | two |\n| --- | --- |\n| x | [[5b386d76|подпись]] |\n\n' },
      { type: 'paragraph', raw: 'prose under it\n' },
    ]);
  });

  test('leaves a pipe the author escaped for themselves as their own', () => {
    expect(cells(table('| a \\| b | [[5b386d76|подпись]] |'), [BRACKET])).toEqual([['a | b', '[[5b386d76|подпись]]']]);
  });

  test('escapes a pipe inside an atom only where the author had not', () => {
    expect(cells(table('| x | [[5b386d76|left \\| right]] |'), [BRACKET])).toEqual([['x', '[[5b386d76|left | right]]']]);
  });

  test('shields the bare pipe behind an even run of backslashes and touches neither', () => {
    expect(cells(table('| x | [[5b386d76|back \\\\| right]] |'), [BRACKET])).toEqual([['x', '[[5b386d76|back \\\\| right]]']]);
  });

  test('reads a form the pattern does not match as ordinary text', () => {
    expect(cells(table('| x | [[5b386d76|unclosed |'), [BRACKET])).toEqual([['x', '[[5b386d76']]);
  });

  test('reads a table holding no atom at all as GFM does', () => {
    expect(cells(table('| x | y |'), [BRACKET])).toEqual([['x', 'y']]);
  });
});
