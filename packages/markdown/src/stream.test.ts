import { describe, expect, test } from 'bun:test';
import { type MarkdownSplit, splitMarkdown } from './stream';

function splitGfm(text: string, from: number): MarkdownSplit {
  return splitMarkdown(text, from, { gfm: true });
}

function streamed(text: string): { start: number; raw: string }[] {
  const settled: { start: number; raw: string }[] = [];
  let from = 0;
  for (let end = 1; end <= text.length; end += 1) {
    const split = splitGfm(text.slice(0, end), from);
    settled.push(...split.settled.map(({ start, raw }) => ({ start, raw })));
    from = split.end;
  }
  return settled;
}

function whole(text: string): { start: number; raw: string }[] {
  const split = splitGfm(text, 0);
  return [...split.settled, ...split.open].map(({ start, raw }) => ({ start, raw }));
}

describe('splitMarkdown', () => {
  test('everything above the tail is settled, and the tail alone is live', () => {
    const split = splitGfm('One.\n\nTwo.\n\nThr', 0);

    expect(split.settled.map((block) => block.raw)).toEqual(['One.\n\n', 'Two.\n\n']);
    expect(split.open.map((block) => [block.mode, block.raw])).toEqual([['live', 'Thr']]);
    expect(split.end).toBe(12);
  });

  test('reads only from where the settled part ends', () => {
    const split = splitGfm('One.\n\nTwo.\n\nThree.\n\nFour', 12);

    expect(split.settled.map((block) => [block.start, block.raw])).toEqual([[12, 'Three.\n\n']]);
    expect(split.open.map((block) => [block.start, block.raw])).toEqual([[20, 'Four']]);
  });

  test.each([
    ['prose, a list and a table', '# Title\n\nSome **bold** text.\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter.\n'],
    ['a line under a paragraph that only later stops being a heading', 'para\n#hash tag\n\nnext\n'],
    ['a table row that only later stops being a heading', '| a |\n| - |\n#x\n\nnext\n'],
    ['a quote and a list taking lazy lines', '> quote\ncontinued\n\n- item\nlazy\n\ndone\n'],
    ['definitions, one of them repeated', 'See [a].\n\n[a]: https://a.example\n[a]: https://b.example\n\nEnd [a].\n'],
    ['carriage returns', 'One.\r\n\r\nTwo.\r\n\r\nThree.\r\n'],
  ])('a body grown character by character settles only blocks it has when read whole: %s', (_, text) => {
    const settled = streamed(text);

    expect(settled.length).toBeGreaterThan(0);
    expect(whole(text).slice(0, settled.length)).toEqual(settled);
  });

  test('an unterminated fence is code that is not highlighted yet', () => {
    const split = splitGfm('Look:\n\n```ts\nconst a = 1', 0);

    expect(split.open.at(-1)?.mode).toBe('open-code');
    expect(split.open.at(-1)?.raw).toBe('```ts\nconst a = 1');
  });

  test('a closed fence is settled, and the prose after it is the tail', () => {
    const split = splitGfm('```ts\nconst a = 1\n```\n\nAfter', 0);

    expect(split.settled.map((block) => block.mode)).toEqual(['full']);
    expect(split.open.map((block) => block.mode)).toEqual(['live']);
  });

  test('a settled reference definition is reported with its link', () => {
    const split = splitGfm('See [a].\n\n[a]: https://example.com "Title"\n\nMore', 0);

    expect(split.definitions.map(({ tag, href, title }) => ({ tag, href, title }))).toEqual([
      { tag: 'a', href: 'https://example.com', title: 'Title' },
    ]);
  });
});
