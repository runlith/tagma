// @vitest-environment jsdom
import { Host } from '@runlith/layer/Host';
import type { Terminal } from '@xterm/xterm';
import { afterEach, expect, test } from 'vitest';
import {
  blankViewport,
  paintsPrintableContent,
  ScrollIntentStore,
  TerminalScrollIntent,
  type ScrollIntentOptions,
} from './ScrollIntent.svelte.js';
import { openEngine, type Engine } from './terminalEngine.js';

const SETTLE_MS = 80;
const LAYOUT_RESTORE_MS = 80;
const REPARENT_RESTORE_MS = 200;
const REDRAW_QUIET_MS = 120;
const REDRAW_CAP_MS = 1_000;

const live: { engine: Engine; intent: TerminalScrollIntent }[] = [];

afterEach(() => {
  for (const pane of live.splice(0)) {
    pane.intent.dispose();
    pane.engine.dispose();
  }
  document.body.replaceChildren();
});

function open(options: ScrollIntentOptions, store = new ScrollIntentStore(), cols = 20, rows = 6) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const engine = openEngine(host, {}, new Host('desktop', 'macos'));
  (engine.terminal as unknown as { _core: { _viewport?: unknown } })._core._viewport = undefined;
  engine.terminal.resize(cols, rows);
  const intent = new TerminalScrollIntent(engine, store, options);
  live.push({ engine, intent });
  return { engine, intent, store, terminal: engine.terminal };
}

function clock() {
  let at = 0;
  let timers: { readonly due: number; readonly step: () => void }[] = [];
  let frames: (() => void)[] = [];
  const options: ScrollIntentOptions = {
    now: () => at,
    delay: (step, ms) => {
      const timer = { due: at + ms, step };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
    frame: (step) => {
      frames.push(step);
      return () => {
        frames = frames.filter((other) => other !== step);
      };
    },
  };
  return {
    options,
    at: () => at,
    paint(rounds = 1) {
      for (let round = 0; round < rounds; round += 1) {
        const due = frames;
        frames = [];
        for (const step of due) step();
      }
    },
    tick(ms: number) {
      at += ms;
      const due = timers.filter((timer) => timer.due <= at).sort((one, other) => one.due - other.due);
      timers = timers.filter((timer) => timer.due > at);
      for (const timer of due) timer.step();
    },
  };
}

const parse = (terminal: Terminal, bytes: string): Promise<void> => new Promise((resolve) => terminal.write(bytes, () => resolve()));

const lines = (count: number, from = 0, width = 0): string =>
  Array.from({ length: count }, (_, at) => `${String(from + at).padStart(2, '0')}${'x'.repeat(width)}\r\n`).join('');

const rowText = (terminal: Terminal, row: number): string => terminal.buffer.active.getLine(row)?.translateToString(true) ?? '';

const firstVisible = (terminal: Terminal): string => rowText(terminal, terminal.buffer.active.viewportY);

const fromBottom = (terminal: Terminal): number => terminal.buffer.active.baseY - terminal.buffer.active.viewportY;

const everything = (terminal: Terminal): string => {
  const rows: string[] = [];
  for (let row = 0; row < terminal.buffer.active.baseY + terminal.rows; row += 1) rows.push(rowText(terminal, row));
  return rows.join('\n');
};

const wheel = (terminal: Terminal, deltaY: number): void => {
  terminal.element?.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }));
};

async function pinAt(intent: TerminalScrollIntent, terminal: Terminal, time: ReturnType<typeof clock>, line: number) {
  wheel(terminal, -100);
  terminal.scrollToLine(line);
  await Promise.resolve();
  time.paint(2);
  time.tick(SETTLE_MS);
  expect(intent.kind).toBe('pinnedViewport');
}

test('a reflow at a new width lands the reader on the same text', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(12, 0, 28));

  const tail = terminal.buffer.active.baseY - 8;
  await pinAt(intent, terminal, time, tail);
  expect(firstVisible(terminal)).toBe('x'.repeat(10));
  expect(rowText(terminal, tail - 1)).toBe(`05${'x'.repeat(18)}`);

  const capture = intent.capture();
  terminal.resize(40, 6);
  intent.restore(capture);

  expect(firstVisible(terminal)).toBe(`05${'x'.repeat(28)}`);
});

test('the scroll chords record what the jump meant, so a reflow keeps the reader where it put them', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(12, 0, 28));
  expect(intent.kind).toBe('followOutput');

  intent.jump('top');
  expect(intent.kind).toBe('pinnedViewport');
  expect(firstVisible(terminal).startsWith('00')).toBe(true);
  expect(fromBottom(terminal)).toBeGreaterThan(0);

  const capture = intent.capture();
  terminal.resize(40, 6);
  intent.restore(capture);
  expect(intent.kind).toBe('pinnedViewport');
  expect(firstVisible(terminal).startsWith('00')).toBe(true);
  expect(fromBottom(terminal)).toBeGreaterThan(0);

  intent.jump('bottom');
  expect(intent.kind).toBe('followOutput');
  expect(fromBottom(terminal)).toBe(0);
  await parse(terminal, lines(4, 12));
  expect(fromBottom(terminal)).toBe(0);
});

test('a wheel up while output runs pins the reader, and typing follows output again', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(20));
  expect(intent.kind).toBe('followOutput');

  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 5);
  const held = firstVisible(terminal);

  await parse(terminal, lines(6, 20));
  expect(intent.kind).toBe('pinnedViewport');
  expect(firstVisible(terminal)).toBe(held);

  terminal.input('\r');
  expect(intent.kind).toBe('followOutput');
  expect(fromBottom(terminal)).toBe(0);
});

test('a pin the viewport never left is a phantom, and reads as following output', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(20));

  wheel(terminal, -100);
  expect(intent.kind).toBe('pinnedViewport');

  expect(intent.capture()?.intent.kind).toBe('followOutput');

  await Promise.resolve();
  time.paint(2);
  time.tick(SETTLE_MS);
  expect(intent.kind).toBe('followOutput');
});

test('a mouse report never turns a pin into a follow, and puts the reader back', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(20));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 5);
  const held = firstVisible(terminal);

  terminal.input('\u001b[<0;10;5M');

  expect(intent.kind).toBe('pinnedViewport');
  expect(firstVisible(terminal)).toBe(held);
});

test('a program erasing the scrollback re-applies the pin once the redraw is quiet', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(30));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 7);
  const offset = fromBottom(terminal);

  await parse(terminal, '\u001b[3J');
  await parse(terminal, lines(20, 100));
  time.tick(REDRAW_QUIET_MS - 1);
  await parse(terminal, lines(12, 200));
  expect(fromBottom(terminal)).toBe(0);

  time.tick(REDRAW_QUIET_MS);

  expect(fromBottom(terminal)).toBe(offset);
  expect(intent.kind).toBe('pinnedViewport');
});

test('an erase whose redraw never goes quiet still lands the reader by the cap', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(30));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 7);
  const offset = fromBottom(terminal);

  const armed = time.at();
  await parse(terminal, '\u001b[3J');
  let landed: number | null = null;
  for (let round = 0; round < 12 && landed === null; round += 1) {
    await parse(terminal, lines(4, round * 10));
    time.tick(REDRAW_QUIET_MS - 1);
    if (fromBottom(terminal) === offset) landed = time.at();
  }

  expect(landed).not.toBeNull();
  expect((landed ?? Number.POSITIVE_INFINITY) - armed).toBeLessThanOrEqual(REDRAW_CAP_MS + REDRAW_QUIET_MS);
  expect(intent.kind).toBe('pinnedViewport');
});

test('a clear brings a pinned reader to the bottom and lets the pane follow its program again', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(20));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 5);

  let released = false;
  intent.whenFollowing(() => (released = true));

  intent.clear();

  expect(intent.kind).toBe('followOutput');
  expect(released).toBe(true);
  await parse(terminal, lines(20, 100));
  expect(terminal.buffer.active.baseY).toBeGreaterThan(0);
  expect(fromBottom(terminal)).toBe(0);
});

test('a restore that meets a renderer without dimensions retries on the next frames', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(20));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 5);
  const held = firstVisible(terminal);

  const capture = intent.capture();
  const scrollToLine = terminal.scrollToLine.bind(terminal);
  let refusals = 2;
  terminal.scrollToLine = (line: number) => {
    if (refusals > 0) {
      refusals -= 1;
      throw new TypeError("Cannot read properties of undefined (reading 'dimensions')");
    }
    scrollToLine(line);
  };
  terminal.scrollToBottom();

  intent.restore(capture);
  expect(fromBottom(terminal)).toBe(0);
  time.paint();
  expect(fromBottom(terminal)).toBe(0);

  time.paint();
  expect(firstVisible(terminal)).toBe(held);
});

test('a scroll call throwing an unknown error reads as retry and is reported once', async () => {
  const time = clock();
  const problems: string[] = [];
  const { intent, terminal } = open({
    ...time.options,
    onProblem: (problem: string) => problems.push(problem),
  });
  await parse(terminal, lines(20));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 5);
  const held = firstVisible(terminal);

  const capture = intent.capture();
  const scrollToLine = terminal.scrollToLine.bind(terminal);
  terminal.scrollToLine = () => {
    throw new Error('a wording no matcher knows');
  };
  terminal.scrollToBottom();

  intent.restore(capture);
  time.paint(3);
  expect(problems).toHaveLength(1);

  terminal.scrollToLine = scrollToLine;
  intent.restore(capture);
  time.paint();
  expect(firstVisible(terminal)).toBe(held);
});

test('the authoritative restore at 80 ms cancels its own frames, so a late one cannot rewind', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(20));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 5);
  const held = firstVisible(terminal);

  const capture = intent.capture();
  terminal.scrollToBottom();
  intent.restoreAfterLayout(capture);
  expect(firstVisible(terminal)).toBe(held);

  time.tick(LAYOUT_RESTORE_MS);
  terminal.scrollToBottom();
  time.paint(3);

  expect(fromBottom(terminal)).toBe(0);
});

test('a reparented pane keeps the reader through the early frames and settles at 200 ms', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(20));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 5);
  const held = firstVisible(terminal);

  const capture = intent.capture();
  terminal.scrollToBottom();
  intent.restoreAfterReparent(capture);

  time.paint(2);
  expect(firstVisible(terminal)).toBe(held);

  terminal.scrollToBottom();
  time.tick(REPARENT_RESTORE_MS);
  expect(firstVisible(terminal)).toBe(held);
});

test('a rebuild latches nothing from the half-cleared buffer and holds a fit until the line is back', async () => {
  const time = clock();
  const { intent, terminal } = open(time.options);
  await parse(terminal, lines(30));
  await pinAt(intent, terminal, time, terminal.buffer.active.baseY - 7);
  const offset = fromBottom(terminal);

  let fitted = false;
  await intent.bracketRebuild(async () => {
    expect(intent.capture()).toBeNull();
    expect(intent.deferDuringRebuild('fit', () => (fitted = true))).toBe(true);
    await parse(terminal, '\u001b[2J\u001b[3J\u001b[H');
    await parse(terminal, lines(30, 100));
    expect(fitted).toBe(false);
  });

  expect(fromBottom(terminal)).toBe(offset);
  await Promise.resolve();
  expect(fitted).toBe(true);
});

test('a remount over the pane store puts the reader back on the same line', async () => {
  const time = clock();
  const store = new ScrollIntentStore();
  const first = open(time.options, store);
  await parse(first.terminal, lines(30));
  await pinAt(first.intent, first.terminal, time, first.terminal.buffer.active.baseY - 7);
  const offset = fromBottom(first.terminal);
  const held = firstVisible(first.terminal);

  first.intent.dispose();
  first.engine.dispose();
  const second = open(time.options, store);
  expect(second.intent.kind).toBe('pinnedViewport');

  await second.intent.bracketRebuild(() => parse(second.terminal, lines(20, 10)));

  expect(fromBottom(second.terminal)).toBe(offset);
  expect(firstVisible(second.terminal)).toBe(held);
});

test("an outgoing instance cannot write over the successor that already claimed the pane's store", async () => {
  const time = clock();
  const store = new ScrollIntentStore();
  const first = open(time.options, store);
  await parse(first.terminal, lines(30));
  await pinAt(first.intent, first.terminal, time, first.terminal.buffer.active.baseY - 7);

  const second = open(time.options, store);
  await parse(second.terminal, lines(30));
  await pinAt(second.intent, second.terminal, time, second.terminal.buffer.active.baseY - 3);
  const successor = store.get();

  await parse(first.terminal, lines(6, 30));
  first.intent.dispose();

  expect(store.get()).toBe(successor);
  expect(fromBottom(second.terminal)).toBe(3);
});

test('the viewport blank pushes what stood there into scrollback, past a stale scroll region', async () => {
  const time = clock();
  const { terminal } = open(time.options);
  await parse(terminal, 'keep-me\r\n');
  await parse(terminal, '\u001b[1;2r');

  await parse(terminal, blankViewport(terminal.rows));

  expect(everything(terminal)).toContain('keep-me');
  expect(terminal.buffer.active.baseY).toBeGreaterThan(0);
  expect(firstVisible(terminal)).toBe('');
});

test('a restore payload that paints no printable cell is refused', () => {
  expect(paintsPrintableContent('\u001b[2J\u001b[3J\u001b[H')).toBe(false);
  expect(paintsPrintableContent('\u001b]0;a title\u0007\u001b[?25l\r\n\u0000')).toBe(false);
  expect(paintsPrintableContent('')).toBe(false);
  expect(paintsPrintableContent('\u001b[2J\u001b[Hbuild ok\r\n')).toBe(true);
});
