// @vitest-environment jsdom
import { Host } from '@runlith/layer/Host';
import { afterEach, expect, test } from 'vitest';
import { composingNow, installGuards, newComposition, newWheelDistance, rtlJoinRanges, wheelReportCount } from './engineGuards.js';
import { openEngine } from './terminalEngine.js';
import type { Engine } from './terminalEngine.js';

const opened: Engine[] = [];

afterEach(() => {
  for (const engine of opened.splice(0)) engine.dispose();
  document.body.replaceChildren();
});

function open(): Engine {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const engine = openEngine(host, {}, new Host('desktop', 'macos'));
  opened.push(engine);
  return engine;
}

function parse(engine: Engine, data: string): Promise<void> {
  return new Promise((resolve) => engine.terminal.write(data, resolve));
}

function row(engine: Engine, index: number): string {
  return engine.terminal.buffer.active.getLine(index)?.translateToString(true) ?? '';
}

test('an OSC handler that throws reads as not handled, and the write loop parses what follows it', async () => {
  const engine = open();
  installGuards(engine);
  engine.terminal.parser.registerOscHandler(777, () => {
    throw new Error('a handler nobody guarded');
  });

  await parse(engine, '\u001b]777;anything\u0007hello');

  expect(row(engine, 0)).toBe('hello');
});

test('a CSI handler that throws leaves the sequence to the handler beneath it', async () => {
  const engine = open();
  installGuards(engine);
  engine.terminal.parser.registerCsiHandler({ final: 'm' }, () => {
    throw new Error('a handler nobody guarded');
  });

  await parse(engine, '\u001b[31mred');

  expect(row(engine, 0)).toBe('red');
  expect(engine.terminal.buffer.active.getLine(0)?.getCell(0)?.getFgColor()).toBe(1);
});

test('the rows carry xterm-focus while the root does, because the cursor blink keys off the rows', async () => {
  const engine = open();
  const root = engine.terminal.element;
  root?.classList.add('focus');
  installGuards(engine);

  expect(root?.querySelector('.xterm-rows')?.classList.contains('xterm-focus')).toBe(true);

  root?.classList.remove('focus');
  await Promise.resolve();

  expect(root?.querySelector('.xterm-rows')?.classList.contains('xterm-focus')).toBe(false);
});

test('a composition is live for ten seconds and its commit silences chords for 250 ms', () => {
  const at = (startedAt: number | null, committedAt: number | null) => ({ ...newComposition(), startedAt, committedAt });
  expect(composingNow(9_999, at(0, null))).toBe(true);
  expect(composingNow(10_001, at(0, null))).toBe(false);
  expect(composingNow(250, at(null, 0))).toBe(true);
  expect(composingNow(251, at(null, 0))).toBe(false);
});

test('a commit runs what waited for it, once, and a composition still open runs nothing', () => {
  const engine = open();
  const composition = newComposition();
  installGuards(engine, { now: () => 0, composition });
  const root = engine.terminal.element;
  const woken: string[] = [];
  composition.waiting.add(() => woken.push('chord'));

  root?.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  expect(composition.startedAt).toBe(0);
  expect(woken).toEqual([]);

  root?.dispatchEvent(new CompositionEvent('compositionend', { data: '한' }));

  expect(woken).toEqual(['chord']);
  expect(composition.startedAt).toBe(null);
  expect(composition.committedAt).toBe(0);
  root?.dispatchEvent(new CompositionEvent('compositionend', { data: '글' }));
  expect(woken).toEqual(['chord']);
});

test('a stale composition stops steering the candidate window, and a live one keeps steering it', async () => {
  for (const [elapsed, expected] of [
    [1_000, '16px'],
    [10_001, '0px'],
  ] as const) {
    let clock = 0;
    const engine = open();
    const root = engine.terminal.element;
    const screen = root?.querySelector<HTMLElement>('.xterm-screen');
    if (screen) {
      screen.getBoundingClientRect = () => ({ width: engine.terminal.cols * 8, height: engine.terminal.rows * 16 }) as DOMRect;
    }
    installGuards(engine, { now: () => clock });

    root?.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    expect(engine.terminal.textarea?.style.top).toBe('0px');

    await parse(engine, '\r\n');
    clock = elapsed;
    root?.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni' }));

    expect(engine.terminal.textarea?.style.top).toBe(expected);
  }
});

test('a trackpad reports one line per row scrolled and carries the fraction', () => {
  const state = newWheelDistance();
  const metrics = { cellHeight: 16, rows: 24 };
  const notch = { deltaY: 24, deltaMode: 0 };

  expect(wheelReportCount(notch, 1, state, metrics)).toBe(1);
  expect(wheelReportCount(notch, 1, state, metrics)).toBe(2);
  expect(wheelReportCount({ deltaY: -24, deltaMode: 0 }, 1, state, metrics)).toBe(1);
});

test('a wheel is compressed by 1 + log2(rows) × 1.6, capped at six rows an event', () => {
  expect(wheelReportCount({ deltaY: 3, deltaMode: 1 }, 1, newWheelDistance())).toBe(3);
  expect(wheelReportCount({ deltaY: 1000, deltaMode: 1 }, 1, newWheelDistance())).toBe(6);
  expect(wheelReportCount({ deltaY: 1000, deltaMode: 1 }, 3, newWheelDistance())).toBe(18);
});

test('a burst under the 45 ms cadence adds rows, and the ramp opens at a quarter of the bonus', () => {
  const state = newWheelDistance();

  expect(wheelReportCount({ deltaY: 4, deltaMode: 1, timeStamp: 0 }, 1, state)).toBe(4);
  expect(wheelReportCount({ deltaY: 4, deltaMode: 1, timeStamp: 16 }, 1, state)).toBe(5);
  expect(wheelReportCount({ deltaY: 4, deltaMode: 1, timeStamp: 200 }, 1, state)).toBe(4);
});

test('two or more strong RTL code points join into one run, and a lone one does not', () => {
  expect(rtlJoinRanges('שלום')).toEqual([[0, 4]]);
  expect(rtlJoinRanges('א ב x')).toEqual([[0, 3]]);
  expect(rtlJoinRanges('a א b')).toEqual([]);
  expect(rtlJoinRanges('plain ascii')).toEqual([]);
});

test('the pointer hides on what the person types only while the setting says so', () => {
  const engine = open();
  let hide = false;
  installGuards(engine, { mouseHideWhileTyping: () => hide });
  const element = engine.terminal.element;

  engine.terminal.input('a');
  expect(element?.style.cursor).toBe('');

  hide = true;
  engine.terminal.input('b');
  expect(element?.style.cursor).toBe('none');

  element?.dispatchEvent(new MouseEvent('mousemove'));
  expect(element?.style.cursor).toBe('');
});

test('the release takes every guard off, and the pointer comes back with it', () => {
  const engine = open();
  const release = installGuards(engine, { mouseHideWhileTyping: () => true });
  engine.terminal.input('a');
  expect(engine.terminal.element?.style.cursor).toBe('none');

  release();

  expect(engine.terminal.element?.style.cursor).toBe('');
  engine.terminal.parser.registerOscHandler(778, () => true);
});
