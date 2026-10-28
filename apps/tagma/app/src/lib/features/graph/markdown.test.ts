// @vitest-environment jsdom
import { codeColours, type MarkdownHtml } from '@runlith/markdown/render';
import { makeRouter } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { testAddresses } from '$lib/app/testing.js';
import { blockRefView } from './blockRefView.js';
import { renderBody } from './markdown.js';

const origin = new ServerOrigin('http://localhost:5634');

const addresses = testAddresses(makeRouter({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith') }));

function tree(blocks: MarkdownHtml[]): Document {
  return new DOMParser().parseFromString(blocks.map((block) => block.html).join(''), 'text/html');
}

function refs(html: MarkdownHtml[]) {
  return [...tree(html).querySelectorAll('a[data-block-ref]')].map((el) => ({
    name: el.getAttribute('data-block-ref'),
    labelled: el.hasAttribute('data-block-label'),
    text: el.textContent,
    inCode: el.closest('code') !== null,
  }));
}

test('a body answers its parsed blocks at once, and colouring patches its code in place with the same text', async () => {
  const text = '# Title\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n\n```ansi\n\u001b[31mred\u001b[0m\n```\n';
  const blocks = renderBody(text, { key: 'drawn-at-once', streaming: false }, origin, addresses);
  const root = document.createElement('div');
  root.innerHTML = blocks.map((block) => block.html).join('');
  const parsed = () => [...root.querySelectorAll('h1, li, pre > code')].map((node) => node.textContent);
  const code = [...root.querySelectorAll('pre > code')];

  expect(parsed()).toEqual(['Title', 'one', 'two', 'const a = 1;', 'red']);
  await new Promise<void>((resolve) => {
    const done = new MutationObserver(() => {
      if (root.querySelectorAll('pre > code span[style]').length < 2) return;
      done.disconnect();
      resolve();
    });
    done.observe(root, { childList: true, subtree: true });
    for (const block of blocks) codeColours(block)(root);
  });
  expect(parsed()).toEqual(['Title', 'one', 'two', 'const a = 1;', 'red']);
  expect([...root.querySelectorAll('pre > code')]).toEqual(code);
});

test('a labelled reference inside a table cell is one link, and the row keeps its columns', async () => {
  const table = ['| зона | что это |', '| --- | --- |', '| inbox | [[5b386d76|Один durable inbox]] |'];
  const html = renderBody(table.join('\n'), { key: 'ref-in-table', streaming: false }, origin, addresses);

  const row = [...tree(html).querySelectorAll('tbody td')].map((cell) => cell.textContent);
  expect(row).toEqual(['inbox', 'Один durable inbox']);
  expect(refs(html)).toEqual([{ name: '5b386d76', labelled: true, text: 'Один durable inbox', inCode: false }]);
});

test('a label is inline markdown rendered inside its one link', async () => {
  const html = renderBody(
    '- [[8208c42d|**С *smo* нельзя начинать фразу.**]] дальше',
    { key: 'formatted-label', streaming: false },
    origin,
    addresses,
  );

  expect(refs(html)).toEqual([{ name: '8208c42d', labelled: true, text: 'С smo нельзя начинать фразу.', inCode: false }]);
  expect(tree(html).querySelector('a[data-block-ref]')?.innerHTML).toBe('<strong>С <em>smo</em> нельзя начинать фразу.</strong>');
});

test('a URL inside a label stays text of the reference, never a nested link', async () => {
  const html = renderBody('[[8208c42d|see https://example.com]]', { key: 'url-in-label', streaming: false }, origin, addresses);

  expect(tree(html).querySelectorAll('a')).toHaveLength(1);
  expect(refs(html)).toEqual([{ name: '8208c42d', labelled: true, text: 'see https://example.com', inCode: false }]);
});

test('a reference addressed to another project is one link keeping its address', async () => {
  const html = renderBody('shop ([[7/4642091b|Shop follow-up]]) открыта', { key: 'addressed', streaming: false }, origin, addresses);

  expect(refs(html)).toEqual([{ name: '7/4642091b', labelled: true, text: 'Shop follow-up', inCode: false }]);
  expect(blockRefView(addresses, '7/4642091b', null, { title: 'Follow-up', project: 'shop', branch: null }).href).toBe('/shop/b/4642091b');
});

test('a code span that is exactly one block reference is the reference', async () => {
  const html = renderBody(
    'See `[[56d609f9]]` and `[[56d609f9|seven owners]]`.',
    { key: 'code-span-is-ref', streaming: false },
    origin,
    addresses,
  );

  expect(refs(html)).toEqual([
    { name: '56d609f9', labelled: false, text: '56d609f9', inCode: false },
    { name: '56d609f9', labelled: true, text: 'seven owners', inCode: false },
  ]);
  expect(tree(html).querySelector('code')).toBeNull();
});

test('a reference to a thread id is one link to that thread, beside block references and inside table cells', async () => {
  const thread = '01a111ea-17e6-76a5-a45f-2036cfe5959a';
  const text = [
    `Asked [[${thread}|refusal-audit]] and [[${thread.toUpperCase()}]] about [[5b386d76]].`,
    '',
    '| who | |',
    '| --- | --- |',
    `| [[${thread}|left \\| right]] | x |`,
  ];
  const html = renderBody(text.join('\n'), { key: 'thread-ref', streaming: false }, origin, addresses);

  const threads = [...tree(html).querySelectorAll('a[data-thread-ref]')].map((el) => ({
    id: el.getAttribute('data-thread-ref'),
    href: el.getAttribute('href'),
    labelled: el.hasAttribute('data-thread-label'),
    text: el.textContent,
  }));
  expect(threads).toEqual([
    { id: thread, href: `/runlith/chat/${thread}`, labelled: true, text: 'refusal-audit' },
    { id: thread, href: `/runlith/chat/${thread}`, labelled: false, text: thread },
    { id: thread, href: `/runlith/chat/${thread}`, labelled: true, text: 'left | right' },
  ]);
  expect(refs(html)).toEqual([{ name: '5b386d76', labelled: false, text: '5b386d76', inCode: false }]);
  expect([...tree(html).querySelectorAll('tbody td')].map((cell) => cell.textContent)).toEqual(['left | right', 'x']);
});

test('a project reference is one link to that project, labelled or not, and a block reference beside it stays a block', async () => {
  const html = renderBody(
    'Compare [[project:5|runlith]] with [[project:12]] and [[5b386d76]].',
    { key: 'project-ref', streaming: false },
    origin,
    addresses,
  );

  const projects = [...tree(html).querySelectorAll('a[data-project-ref]')].map((el) => ({
    id: el.getAttribute('data-project-ref'),
    labelled: el.hasAttribute('data-project-label'),
    text: el.textContent,
  }));
  expect(projects).toEqual([
    { id: '5', labelled: true, text: 'runlith' },
    { id: '12', labelled: false, text: 'project 12' },
  ]);
  expect(refs(html)).toEqual([{ name: '5b386d76', labelled: false, text: '5b386d76', inCode: false }]);
});

test('file paths in prose preserve their spelling and locations without turning URLs or link labels into nested paths', async () => {
  const text = [
    'Read (/Users/ana/.tagma/scratch/brief-terminal.md), then src/my_file.ts:12:3.',
    'See [source](src/main.ts:4:2), file:///tmp/report%20one.md and C:\\work\\report.md:7.',
    'Keep /tmp/report(final).md and https://example.com/docs/a.md beside [src/label.ts](https://example.com).',
  ].join('\n');
  const html = renderBody(text, { key: 'prose-paths', streaming: false }, origin, addresses);
  const body = tree(html);
  expect(
    [...body.querySelectorAll('[data-path]')].map((node) => ({
      path: node.getAttribute('data-path'),
      line: node.getAttribute('data-line'),
      column: node.getAttribute('data-column'),
      text: node.textContent,
    })),
  ).toEqual([
    { path: '/Users/ana/.tagma/scratch/brief-terminal.md', line: null, column: null, text: '/Users/ana/.tagma/scratch/brief-terminal.md' },
    { path: 'src/my_file.ts', line: '12', column: '3', text: 'src/my_file.ts:12:3' },
    { path: 'src/main.ts', line: '4', column: '2', text: 'source' },
    { path: '/tmp/report one.md', line: null, column: null, text: 'file:///tmp/report%20one.md' },
    { path: 'C:\\work\\report.md', line: '7', column: null, text: 'C:\\work\\report.md:7' },
    { path: '/tmp/report(final).md', line: null, column: null, text: '/tmp/report(final).md' },
  ]);
  expect([...body.querySelectorAll('a')].map((node) => node.getAttribute('href'))).toEqual([
    'https://example.com/docs/a.md',
    'https://example.com',
  ]);
});

test('path placeholders stay literal in live, finished and reopened bodies while HTML beside them still renders', async () => {
  const paths = ['/posters/<w>/<s>.png', 'C:\\posters\\<scene>.png'];
  const text = `Before.\n\nRead ${paths.join(' and ')}.\n\nAfter <s>old</s>, **new** and src/main.ts<br>Next.\n\nRead /tmp/<s>**kept**</s>.`;
  const key = 'path-placeholders';
  renderBody('Before.\n\nRead /posters/<w>/<s', { key, streaming: true }, origin, addresses);
  const live = renderBody(text, { key, streaming: true }, origin, addresses);
  const finished = renderBody(text, { key, streaming: false }, origin, addresses);
  const reopened = renderBody(text, { key: `${key}:reopened`, streaming: false }, origin, addresses);

  for (const html of [live, finished, reopened]) {
    const body = tree(html);
    expect([...body.querySelectorAll('[data-path]')].map((node) => node.textContent)).toEqual([...paths, 'src/main.ts', '/tmp/']);
    expect([...body.querySelectorAll('p')].map((node) => node.textContent)).toEqual([
      'Before.',
      `Read ${paths.join(' and ')}.`,
      'After old, new and src/main.tsNext.',
      'Read /tmp/kept.',
    ]);
    expect([...body.querySelectorAll('s')].map((node) => node.textContent)).toEqual(['old', 'kept']);
    expect([...body.querySelectorAll('strong')].map((node) => node.textContent)).toEqual(['new', 'kept']);
    expect(body.querySelectorAll('br')).toHaveLength(1);
  }
});

test.each([
  [
    'prose, a list and a table',
    '# Title\n\nSome **bold** `agent.keepWarm` text.\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | [[5b386d76|ref]] |\n\nAfter.\n',
  ],
  ['a quote and a list taking lazy lines', '> quote\ncontinued\n\n- item\nlazy\n\n1. first\n\n2. loose\n\ndone'],
  [
    'definitions used before and after',
    'See [a] and [b].\n\n[a]: https://a.example\n\nMiddle [a].\n\n[b]: https://b.example "B"\n\nEnd [b].',
  ],
  ['a fence and a heading under a paragraph', 'Look:\n\n```ts\nconst a = 1;\n```\n\npara\nunder\n---\n\ntail `code'],
  ['carriage returns', 'One.\r\n\r\nTwo `x`.\r\n\r\n- three\r\n'],
  ['definitions inside a quote and a list', 'See [a] and [b].\n\n> [a]: https://a.example\n\n- [b]: https://b.example\n\nEnd [a] [b].'],
  ['raw markup open across blocks', 'Intro.\n\n<div>\n\nHello <b>bold\n\nstill</b>\n\n</div>\n\nAfter.'],
])('a body finished after streaming draws the same HTML as the same text drawn whole: %s', async (name, text) => {
  for (let end = 1; end < text.length; end += 5) {
    renderBody(text.slice(0, end), { key: `streamed:${name}`, streaming: true }, origin, addresses);
  }
  const finished = renderBody(text, { key: `streamed:${name}`, streaming: false }, origin, addresses);
  const whole = renderBody(text, { key: `whole:${name}`, streaming: false }, origin, addresses);

  expect(finished.length).toBeGreaterThan(1);
  expect(tree(finished).body.innerHTML).toBe(tree(whole).body.innerHTML);
});

test('a code span that holds a reference and other text stays code', async () => {
  const html = renderBody(
    'The syntax is `[[56d609f9|label]] plus words`.',
    { key: 'code-span-with-extra', streaming: false },
    origin,
    addresses,
  );

  expect(refs(html)).toEqual([]);
  expect(tree(html).querySelector('code')?.textContent).toBe('[[56d609f9|label]] plus words');
});
