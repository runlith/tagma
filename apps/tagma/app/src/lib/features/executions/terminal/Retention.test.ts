// @vitest-environment jsdom
import { Terminal } from '@xterm/xterm';
import { afterEach, expect, test } from 'vitest';
import { TerminalRetention } from './Retention.js';

const opened: Terminal[] = [];

afterEach(() => {
  for (const terminal of opened.splice(0)) terminal.dispose();
});

function open(options: { cols?: number; rows?: number; scrollback?: number } = {}): Terminal {
  const terminal = new Terminal({ cols: options.cols ?? 10, rows: options.rows ?? 4, scrollback: options.scrollback ?? 0 });
  opened.push(terminal);
  return terminal;
}

const feed = (terminal: Terminal, data: string): Promise<void> =>
  new Promise((resolve) => {
    terminal.write(data, resolve);
  });

const link = (uri: string, params = ''): string => `\u001b]8;${params};${uri}\u001b\\x`;

test('the engine accounts combined cells, extended attributes and links incrementally and releases them on reset', async () => {
  const terminal = open({ cols: 10, rows: 2, scrollback: 2 });
  const before = terminal.dynamicStorage;
  await feed(terminal, `\u001b[4:3m${link('https://example.com/account')}e\u0301\r\nmore\u0301`);
  expect(terminal.dynamicStorage?.lineBytes).toBeGreaterThan(before?.lineBytes ?? 0);
  expect(terminal.dynamicStorage?.linkBytes).toBeGreaterThan(before?.linkBytes ?? 0);
  terminal.reset();
  expect(terminal.dynamicStorage?.lineBytes).toBe(0);
  expect(terminal.dynamicStorage?.linkBytes).toBe(0);
});

test('the account releases dynamic storage when its last line leaves the scrollback', async () => {
  const terminal = open({ cols: 10, rows: 2, scrollback: 0 });
  await feed(terminal, `${link('https://example.com/evicted')}e\u0301\u001b]8;;\u001b\\\u001b[0m`);
  expect(terminal.dynamicStorage?.lineBytes).toBeGreaterThan(0);
  expect(terminal.dynamicStorage?.linkBytes).toBeGreaterThan(0);
  await feed(terminal, '\r\nplain\r\n');
  expect(terminal.dynamicStorage?.lineBytes).toBe(0);
  expect(terminal.dynamicStorage?.linkBytes).toBe(0);
});

test('a cell grown past a stream-safe cluster refuses, and the refusal names what the screen carries', async () => {
  const terminal = open({ cols: 10 });
  const retention = new TerminalRetention(terminal);

  await feed(terminal, `a${'\u0301'.repeat(700)}`);

  expect(retention.check()).toBe(
    'This terminal stopped taking output: one line grew to 710 characters against the 620 a 10-column screen carries, so the program was growing one cell without end.',
  );
});

test('every cell carrying an ordinary cluster is text the screen holds, not a refusal', async () => {
  const terminal = open({ cols: 10 });
  const retention = new TerminalRetention(terminal);

  await feed(terminal, 'e\u0301\u0302'.repeat(10));

  expect(retention.check()).toBeNull();
});

test('a line registering more link entries than the buffer holds lines refuses', async () => {
  const terminal = open({ cols: 80, rows: 4, scrollback: 0 });
  const retention = new TerminalRetention(terminal);

  await feed(terminal, link('https://a').repeat(5));

  expect(retention.check()).toBe(
    'This terminal stopped taking output: one line registered 5 link entries against the 4 this screen keeps, and the engine holds every one of them until its line leaves the scrollback.',
  );
});

test('a TUI scrolling its alternate screen is not refused: the engine released those lines, and so has the account', async () => {
  const terminal = open({ cols: 80, rows: 4, scrollback: 0 });
  const retention = new TerminalRetention(terminal);

  await feed(terminal, `\u001b[?1049h${`${link('https://a')}\r\n`.repeat(10)}`);

  expect(retention.check()).toBeNull();
});

test('a link the engine reuses by its id is charged once, however often the line redraws it', async () => {
  const terminal = open({ cols: 80, rows: 4, scrollback: 0 });
  const retention = new TerminalRetention(terminal);

  await feed(terminal, link('https://a', 'id=one').repeat(8));

  expect(retention.check()).toBeNull();
});

test('a URI costs the entries it is worth, so one link past the derived length refuses', async () => {
  const terminal = open({ cols: 80, rows: 4, scrollback: 0 });
  const retention = new TerminalRetention(terminal);

  await feed(terminal, link(`https://a/${'b'.repeat(1270)}`));

  expect(retention.check()).toBe(
    'This terminal stopped taking output: one line registered 6 link entries against the 4 this screen keeps, and the engine holds every one of them until its line leaves the scrollback.',
  );
});
