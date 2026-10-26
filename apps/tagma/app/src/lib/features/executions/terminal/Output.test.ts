import { ByteOffset } from '@runlith/executions/protocol/record';
import { Scope } from '@runlith/layer/Scope';
import { afterEach, expect, test, vi } from 'vitest';
import {
  FOREGROUND_BACKLOG_WARNING,
  HIDDEN_BACKLOG_WARNING,
  TerminalOutput,
  incompleteControlTail,
  type OutputTarget,
  type PaneOutput,
  type Time,
} from './Output.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const at = (offset: number): ByteOffset => ByteOffset.make(String(offset));
const KIB = 1024;

const timeOver = () => {
  let now = 0;
  let sequence = 0;
  const timers: { at: number; id: number; run: () => void }[] = [];
  const frames: (() => void)[] = [];
  const posted: (() => void)[] = [];
  const time: Time = {
    now: () => now,
    after: (ms, run) => {
      const id = ++sequence;
      timers.push({ at: now + ms, id, run });
      return () => {
        const index = timers.findIndex((timer) => timer.id === id);
        if (index !== -1) timers.splice(index, 1);
      };
    },
    frame: (run) => {
      frames.push(run);
      return () => {
        const index = frames.indexOf(run);
        if (index !== -1) frames.splice(index, 1);
      };
    },
    post: (run) => {
      posted.push(run);
    },
  };
  return {
    time,
    advance(ms: number): void {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = timers[0];
        if (next === undefined || next.at > until) break;
        timers.shift();
        now = next.at;
        next.run();
      }
      now = until;
    },
    tick(): number {
      const runs = posted.splice(0);
      for (const run of runs) run();
      return runs.length;
    },
    frame(): void {
      for (const run of frames.splice(0)) run();
    },
  };
};

const targetOver = (options: { readonly eager?: boolean; readonly scrolls?: boolean } = {}) => {
  const writes: string[] = [];
  const callbacks: ((() => void) | undefined)[] = [];
  const refreshes: { start: number; end: number; sync: boolean }[] = [];
  const held = { line: '' };
  const active = {
    baseY: 0,
    viewportY: 0,
    cursorX: 0,
    cursorY: 0,
    getLine: (): { translateToString(): string } => ({ translateToString: () => held.line }),
  };
  let rejecting = false;
  const target: OutputTarget = {
    rows: 24,
    cols: 80,
    options: { scrollback: 5000 },
    parser: { registerOscHandler: () => ({ dispose: () => undefined }) },
    registerMarker: () => ({ line: active.baseY + active.cursorY, dispose: () => undefined }),
    buffer: { active },
    write(data, callback) {
      if (rejecting) throw new Error('write data discarded, use flow control to avoid losing data');
      writes.push(data);
      if (options.eager === true) {
        if (options.scrolls === true) active.baseY += 1;
        callback?.();
        return;
      }
      callbacks.push(callback);
    },
    refresh(start, end) {
      refreshes.push({ start, end, sync: false });
    },
    _core: {
      refresh(start, end, sync) {
        refreshes.push({ start, end, sync: sync === true });
      },
    },
  };
  return {
    target,
    writes,
    refreshes,
    active,
    held,
    parse(): void {
      callbacks.shift()?.();
    },
    parseAll(): void {
      while (callbacks.length > 0) callbacks.shift()?.();
    },
    reject(): void {
      rejecting = true;
    },
  };
};

const paneOver = (state: { visible?: boolean; focused?: boolean; webgl?: boolean } = {}) => {
  const pane = { visible: true, focused: true, webgl: true, ...state, rereads: [] as string[], deaths: 0, unavailable: [] as string[] };
  const facts: PaneOutput = {
    visible: () => pane.visible,
    focused: () => pane.focused,
    webgl: () => pane.webgl,
    scrollbackRows: () => 5000,
    reread: (from) => {
      pane.rereads.push(from);
    },
    dead: () => {
      pane.deaths += 1;
    },
    unavailable: (message) => {
      pane.unavailable.push(message);
    },
  };
  return { pane, facts };
};

const creditsOver = () => {
  const fired = new Map<number, number>();
  return {
    fired,
    for: (index: number) => () => fired.set(index, (fired.get(index) ?? 0) + 1),
    total: () => [...fired.values()].reduce((sum, count) => sum + count, 0),
    each: () => [...fired.values()].every((count) => count === 1),
  };
};

const schedulerOver = () => {
  const clock = timeOver();
  const page = { hidden: false };
  return { ...clock, page, scheduler: new TerminalOutput(clock.time, () => page.hidden, Scope.make()) };
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('a backlog past the cap credits every dropped chunk once, writes the warning line and re-reads from the earliest offset on reveal', () => {
  const { scheduler, advance, tick } = schedulerOver();
  const engine = targetOver();
  const { pane, facts } = paneOver({ visible: false });
  const writer = scheduler.register(engine.target, facts);
  const credits = creditsOver();

  for (let index = 0; index <= 4096; index += 1) writer.write(encode('x'), credits.for(index), at(index));
  expect(credits.total()).toBe(4097);
  expect(credits.each()).toBe(true);

  advance(50);
  tick();
  expect(engine.writes).toEqual([HIDDEN_BACKLOG_WARNING]);

  writer.write(encode('later'), credits.for(5000), at(5000));
  pane.visible = true;
  writer.focus(true);
  expect(pane.rereads).toEqual(['0']);
  expect(credits.fired.get(5000)).toBe(1);
  tick();
  expect(engine.writes).toEqual([HIDDEN_BACKLOG_WARNING]);
});

test('replacing queued output credits the discarded bytes once and credits the screen only after parsing', () => {
  const { scheduler } = schedulerOver();
  const engine = targetOver();
  const writer = scheduler.register(engine.target, paneOver({ visible: false }).facts);
  const credits = creditsOver();
  writer.write(encode('stale'), credits.for(0), at(0));
  writer.screen(encode('screen'), credits.for(1));
  expect(credits.fired.get(0)).toBe(1);
  expect(credits.fired.get(1)).toBeUndefined();
  engine.parse();
  expect(credits.fired.get(1)).toBe(1);
});

test('a reveal drains a bounded slice of the hidden backlog at once, and the rest keeps its place on the drain', () => {
  const { scheduler, advance, tick } = schedulerOver();
  const engine = targetOver();
  const { pane, facts } = paneOver({ visible: false });
  const writer = scheduler.register(engine.target, facts);
  const credits = creditsOver();

  writer.write(encode('x'.repeat(640 * 1024)), credits.for(0));
  expect(engine.writes).toEqual([]);

  pane.visible = true;
  writer.focus(true);

  expect(engine.writes).toHaveLength(16);
  expect(engine.writes.join('').length).toBe(256 * 1024);

  advance(50);
  tick();
  expect(engine.writes.length).toBeGreaterThan(16);
  expect(engine.writes.join('')).toBe('x'.repeat(engine.writes.join('').length));
});

test('an engine whose own retention passed what a screen holds takes nothing more, and every delivery is still credited', () => {
  const { scheduler } = schedulerOver();
  const engine = targetOver();
  const { pane, facts } = paneOver();
  const writer = scheduler.register(engine.target, facts);
  const credits = creditsOver();

  writer.write(encode('hi'), credits.for(0));
  engine.held.line = 'x'.repeat(5000);
  engine.parseAll();

  expect(pane.unavailable).toHaveLength(1);
  expect(pane.deaths).toBe(0);
  writer.write(encode('more'), credits.for(1));
  expect(engine.writes).toEqual(['hi']);
  expect(credits.total()).toBe(2);
  expect(credits.each()).toBe(true);
});

test('a hidden pane drains two 16 KiB writes a tick, and a visible flood eight', () => {
  const { scheduler, advance, tick } = schedulerOver();
  const hidden = targetOver();
  const visible = targetOver();
  scheduler.register(hidden.target, paneOver({ visible: false }).facts);
  const foreground = scheduler.register(visible.target, paneOver().facts);
  const background = scheduler.register(hidden.target, paneOver({ visible: false }).facts);

  for (let index = 0; index < 10; index += 1) background.write(encode('h'.repeat(16 * KIB)), () => undefined);
  expect(hidden.writes).toHaveLength(0);
  advance(50);
  expect(hidden.writes).toHaveLength(2);
  advance(16);
  expect(hidden.writes).toHaveLength(4);
  expect(hidden.writes.every((write) => write.length === 16 * KIB)).toBe(true);

  foreground.write(encode('v'.repeat(200 * KIB)), () => undefined);
  expect(visible.writes).toHaveLength(0);
  tick();
  expect(visible.writes).toHaveLength(8);
  expect(hidden.writes).toHaveLength(4);
});

test('a hidden document drains on the posted macrotask, at the same writes a tick', () => {
  const { scheduler, page, advance, tick } = schedulerOver();
  const engine = targetOver();
  page.hidden = true;
  const writer = scheduler.register(engine.target, paneOver({ visible: false }).facts);

  for (let index = 0; index < 10; index += 1) writer.write(encode('h'.repeat(16 * KIB)), () => undefined);
  advance(5000);
  expect(engine.writes).toHaveLength(0);

  expect(tick()).toBe(1);
  expect(engine.writes).toHaveLength(2);
  expect(tick()).toBe(1);
  expect(engine.writes).toHaveLength(4);
  expect(engine.writes.every((write) => write.length === 16 * KIB)).toBe(true);

  page.hidden = false;
  tick();
  expect(engine.writes).toHaveLength(6);
  advance(16);
  expect(engine.writes).toHaveLength(8);
});

test('a focused pane writes echo inline within its budget and queues a flood behind the drain', () => {
  const { scheduler, advance, tick } = schedulerOver();
  const engine = targetOver();
  const writer = scheduler.register(engine.target, paneOver().facts);

  writer.write(encode('hi'), () => undefined);
  expect(engine.writes).toEqual(['hi']);

  writer.write(encode('f'.repeat(3000)), () => undefined);
  expect(engine.writes).toHaveLength(1);
  tick();
  expect(engine.writes).toHaveLength(2);

  writer.typed();
  advance(100);
  writer.write(encode(`\u001b[2K${'r'.repeat(3000)}`), () => undefined);
  expect(engine.writes).toHaveLength(3);
  advance(200);
  writer.write(encode(`\u001b[2K${'r'.repeat(3000)}`), () => undefined);
  expect(engine.writes).toHaveLength(3);
  tick();
  expect(engine.writes).toHaveLength(4);

  advance(500);
  for (let index = 0; index < 64; index += 1) writer.write(encode('b'.repeat(2048)), () => undefined);
  expect(engine.writes).toHaveLength(68);
  writer.write(encode('!'), () => undefined);
  expect(engine.writes).toHaveLength(68);
  advance(500);
  tick();
  expect(engine.writes.at(-1)).toBe('!');
  writer.write(encode('?'), () => undefined);
  expect(engine.writes.at(-1)).toBe('?');
});

test('an echo pulls the queued backlog through the flush bound and goes inline behind it', () => {
  const { scheduler, tick } = schedulerOver();
  const engine = targetOver();
  const writer = scheduler.register(engine.target, paneOver().facts);

  writer.write(encode('y'.repeat(100 * KIB)), () => undefined);
  expect(engine.writes).toEqual([]);

  writer.write(encode('a'), () => undefined);
  expect(engine.writes.join('')).toBe(`${'y'.repeat(100 * KIB)}a`);
  expect(engine.writes.length).toBeGreaterThan(1);

  const written = engine.writes.length;
  tick();
  expect(engine.writes).toHaveLength(written);
});

test('a visible pane that is not the focused one shares one inline budget and never echoes control sequences inline', () => {
  const { scheduler } = schedulerOver();
  const left = targetOver();
  const right = targetOver();
  const one = scheduler.register(left.target, paneOver({ focused: false }).facts);
  const other = scheduler.register(right.target, paneOver({ focused: false }).facts);

  one.write(encode('p'.repeat(32 * KIB)), () => undefined);
  expect(left.writes).toHaveLength(1);
  other.write(encode('q'), () => undefined);
  expect(right.writes).toHaveLength(0);
  other.write(encode('\u001b[2Kq'), () => undefined);
  expect(right.writes).toHaveLength(0);
});

test('a completion step that throws never reaches the engine, is reported five times at most, and the next chunk still credits', () => {
  const { scheduler } = schedulerOver();
  const engine = targetOver();
  const writer = scheduler.register(engine.target, paneOver().facts);
  const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  for (let index = 0; index < 7; index += 1) {
    writer.write(encode('t'), () => {
      throw new Error(`settle failed ${index}`);
    });
  }
  const credits = creditsOver();
  writer.write(encode('u'), credits.for(1));
  for (let index = 0; index < 8; index += 1) engine.parse();

  expect(reported).toHaveBeenCalledTimes(5);
  expect(credits.fired.get(1)).toBe(1);
});

test('a pipeline that parses nothing for 10 s is probed, and one silent for another 10 s is certified dead once', () => {
  const { scheduler, advance } = schedulerOver();
  const engine = targetOver();
  const { pane, facts } = paneOver();
  const writer = scheduler.register(engine.target, facts);
  const credits = creditsOver();

  writer.write(encode('stuck'), credits.for(1));
  advance(10_000);
  expect(engine.writes).toEqual(['stuck', '']);
  expect(pane.deaths).toBe(0);
  advance(10_000);
  expect(pane.deaths).toBe(1);
  expect(credits.fired.get(1)).toBe(1);

  writer.write(encode('after'), credits.for(2));
  expect(credits.fired.get(2)).toBe(1);
  expect(engine.writes).toHaveLength(2);
  advance(30_000);
  expect(pane.deaths).toBe(1);
});

test('a probe that completes proves the parser alive: a slow pipeline is not certified dead', () => {
  const { scheduler, advance } = schedulerOver();
  const engine = targetOver();
  const { pane, facts } = paneOver();
  const writer = scheduler.register(engine.target, facts);

  writer.write(encode('slow'), () => undefined);
  advance(10_000);
  expect(engine.writes).toEqual(['slow', '']);
  engine.parseAll();
  advance(30_000);
  expect(pane.deaths).toBe(0);
});

test('a write the engine rejects is credited and certifies the pipeline dead', () => {
  const { scheduler } = schedulerOver();
  const engine = targetOver();
  const { pane, facts } = paneOver();
  const writer = scheduler.register(engine.target, facts);
  const credits = creditsOver();

  engine.reject();
  writer.write(encode('refused'), credits.for(1));
  expect(credits.fired.get(1)).toBe(1);
  expect(pane.deaths).toBe(1);
});

test('a renderer-risk chunk refreshes the rows after its parse, and once more a frame later when the parse scrolled the viewport', () => {
  const { scheduler, frame } = schedulerOver();
  const engine = targetOver();
  const writer = scheduler.register(engine.target, paneOver().facts);

  writer.write(encode('plain text'), () => undefined);
  engine.parse();
  expect(engine.refreshes).toEqual([]);

  writer.write(encode('\u001b[41m filled \u001b[0m'), () => undefined);
  engine.parse();
  expect(engine.refreshes).toEqual([{ start: 0, end: 23, sync: false }]);
  frame();
  expect(engine.refreshes).toHaveLength(1);

  writer.write(encode('\u001b[41m more \u001b[0m'), () => undefined);
  engine.active.baseY = 3;
  engine.parse();
  expect(engine.refreshes).toHaveLength(2);
  frame();
  expect(engine.refreshes).toHaveLength(3);
});

test("a drain tick's writes cost one refresh, and the next frame is asked for only when the tick moved the viewport", () => {
  const { scheduler, advance, tick, frame } = schedulerOver();
  const engine = targetOver({ eager: true, scrolls: true });
  const writer = scheduler.register(engine.target, paneOver().facts);

  const risky = `\u001b[41m${'z'.repeat(20 * KIB)}`;
  writer.write(encode(risky), () => undefined);
  writer.write(encode(risky), () => undefined);
  expect(engine.refreshes).toEqual([]);

  advance(50);
  tick();
  expect(engine.refreshes).toEqual([{ start: 0, end: 23, sync: false }]);
  frame();
  expect(engine.refreshes).toHaveLength(2);

  const still = targetOver({ eager: true });
  const quiet = scheduler.register(still.target, paneOver().facts);
  const calm = `\u001b[41m${'q'.repeat(20 * KIB)}`;
  quiet.write(encode(calm), () => undefined);
  quiet.write(encode(calm), () => undefined);
  advance(50);
  tick();
  expect(still.refreshes).toEqual([{ start: 0, end: 23, sync: false }]);
  frame();
  expect(still.refreshes).toHaveLength(1);
});

test('under the DOM renderer the refresh is synchronous', () => {
  const { scheduler } = schedulerOver();
  const engine = targetOver();
  const writer = scheduler.register(engine.target, paneOver({ webgl: false }).facts);

  writer.write(encode('a\rb'), () => undefined);
  engine.parse();
  expect(engine.refreshes).toEqual([{ start: 0, end: 23, sync: true }]);
});

test('an incomplete control sequence at the end of a chunk is held and written whole with the next chunk', () => {
  const { scheduler, tick } = schedulerOver();
  const engine = targetOver();
  const writer = scheduler.register(engine.target, paneOver().facts);
  const credits = creditsOver();

  writer.write(encode('abc\u001b['), credits.for(1));
  expect(engine.writes).toEqual(['abc']);
  writer.write(encode('2Jdef'), credits.for(2));
  expect(engine.writes).toEqual(['abc', '\u001b[2Jdef']);

  writer.write(new Uint8Array([0xc3]), credits.for(3));
  expect(credits.fired.get(3)).toBe(1);
  expect(engine.writes).toHaveLength(2);
  writer.write(new Uint8Array([0xa9]), credits.for(4));
  expect(engine.writes.at(-1)).toBe('é');

  writer.write(encode(`\u001b]52;c;${'A'.repeat(5000)}`), credits.for(5));
  tick();
  expect(engine.writes.at(-1)?.startsWith('\u001b]52;c;')).toBe(true);
});

test('the tail scan is fold-safe across chunk boundaries and closes on every terminator', () => {
  const stream = 'ok\u001b[31mred\u001b]0;title\u0007\u001bP1$q\u001b\\tail\u001b[?25';
  expect(incompleteControlTail(stream)).toBe('\u001b[?25');
  expect(incompleteControlTail(incompleteControlTail('ok\u001b[3') + '1mred')).toBe('');
  expect(incompleteControlTail('\u001b]0;title\u001b\\')).toBe('');
  expect(incompleteControlTail('\u001b')).toBe('\u001b');
  expect(incompleteControlTail('\u001b[\u0018x')).toBe('');
});

test('a visible flood drops re-arm one re-read that follows the last drop by 2 s and discards what the re-read covers', () => {
  const { scheduler, advance, tick } = schedulerOver();
  const engine = targetOver();
  const { pane, facts } = paneOver();
  const writer = scheduler.register(engine.target, facts);
  const credits = creditsOver();

  writer.replaying(true);
  for (let index = 0; index <= 4096; index += 1) writer.write(encode('r'), credits.for(index), at(index));
  expect(credits.total()).toBe(4097);
  expect(pane.rereads).toEqual([]);
  tick();
  expect(engine.writes).toEqual([FOREGROUND_BACKLOG_WARNING]);

  advance(1000);
  for (let index = 5000; index <= 9096; index += 1) writer.write(encode('r'), credits.for(index), at(index));
  advance(1999);
  expect(pane.rereads).toEqual([]);
  advance(1);
  expect(pane.rereads).toEqual(['0']);

  expect(credits.each()).toBe(true);
  tick();
  expect(engine.writes.filter((write) => write !== FOREGROUND_BACKLOG_WARNING)).toEqual([]);
});

test('the replay guard stands until the last replay chunk parsed, and a live chunk does not extend it', () => {
  const { scheduler, tick } = schedulerOver();
  const engine = targetOver();
  const writer = scheduler.register(engine.target, paneOver().facts);

  writer.replaying(true);
  writer.write(encode('recorded'), () => undefined);
  writer.replaying(false);
  writer.write(encode('live'), () => undefined);
  expect(writer.replayInFlight()).toBe(true);
  tick();
  engine.parse();
  expect(writer.replayInFlight()).toBe(false);

  writer.replaying(true);
  writer.write(encode('again'), () => undefined);
  expect(writer.replayInFlight()).toBe(true);
  writer.dispose();
  expect(writer.replayInFlight()).toBe(false);
});

test('disposing a writer credits what it held and arms nothing after', () => {
  const { scheduler, advance } = schedulerOver();
  const engine = targetOver();
  const { pane, facts } = paneOver();
  const writer = scheduler.register(engine.target, facts);
  const credits = creditsOver();

  writer.write(encode('pending'), credits.for(1));
  writer.dispose();
  expect(credits.fired.get(1)).toBe(1);
  writer.write(encode('after'), credits.for(2));
  expect(credits.fired.get(2)).toBe(1);
  expect(engine.writes).toEqual(['pending']);
  advance(30_000);
  expect(pane.deaths).toBe(0);
});

test('a BEL in a hidden pane rings once, an OSC-terminating BEL never rings, and a truncated OSC cannot swallow the next bell', () => {
  const { scheduler } = schedulerOver();
  const engine = targetOver();
  const { facts } = paneOver({ visible: false });
  let bells = 0;
  const writer = scheduler.register(engine.target, { ...facts, onBell: () => (bells += 1) });

  writer.write(encode('done\u0007'), () => undefined);
  expect(bells).toBe(1);
  writer.write(encode('\u001b]0;vim\u0007'), () => undefined);
  expect(bells).toBe(1);
  writer.write(encode('\u001b]0;crashed\u0018plain\u0007'), () => undefined);
  expect(bells).toBe(2);
});
