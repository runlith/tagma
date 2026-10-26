import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Schema } from 'effect';
import { Terminal } from '@xterm/headless';
import { ScreenAppearance, type TerminalColors } from '@runlith/executions/protocol/appearance';
import { makeAppearance, type Appearance, type AppearanceUnavailable } from './Appearance';

const base: TerminalColors = {
  palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
  foreground: 0xeeeeee,
  background: 0x101010,
  cursor: 0xaabbcc,
};
const terminal = () =>
  Effect.acquireRelease(
    Effect.sync(() => new Terminal({ cols: 8, rows: 2, cursorStyle: 'bar' })),
    (terminal) => Effect.sync(() => terminal.dispose()),
  );
const write = (terminal: Terminal, data: string) =>
  Effect.callback<void>((resume) => {
    terminal.write(new TextEncoder().encode(data), () => resume(Effect.void));
  });
const osc = (code: number, data = '') => `\x1b]${code}${data ? `;${data}` : ''}\x07`;

it.live('palette and default color changes, queries and resets agree with the copied cell colors', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const replies: string[] = [];
    const appearance = yield* makeAppearance({ terminal: term, base, reply: (bytes) => replies.push(new TextDecoder().decode(bytes)) });
    yield* write(
      term,
      osc(4, '1;#abc;1;?;200;rgb:f/0/8;200;?') +
        osc(10, 'rgb:12/34/56;#123456789;#123456789abc') +
        osc(10, '?;?;?') +
        '\x1b[31mA\x1b[38;5;200mB\x1b[39mC',
    );
    const state = yield* appearance.snapshot();
    expect(state.colors.palette[1]).toBe(0xa0b0c0);
    expect(state.colors.palette[200]).toBe(0xff0088);
    expect(state.colors).toMatchObject({ foreground: 0x123456, background: 0x124578, cursor: 0x12569a });
    expect(replies).toEqual([
      '\x1b]4;1;rgb:a0a0/b0b0/c0c0\x1b\\',
      '\x1b]4;200;rgb:ffff/0000/8888\x1b\\',
      '\x1b]10;rgb:1212/3434/5656\x1b\\',
      '\x1b]11;rgb:1212/4545/7878\x1b\\',
      '\x1b]12;rgb:1212/5656/9a9a\x1b\\',
    ]);
    const line = term.buffer.active.getLine(0)!;
    expect(state.colors.palette[line.getCell(0)!.getFgColor()]).toBe(0xa0b0c0);
    expect(state.colors.palette[line.getCell(1)!.getFgColor()]).toBe(0xff0088);
    expect(line.getCell(2)!.isFgDefault()).toBe(true);
    expect(term.options.theme).toMatchObject({ red: '#a0b0c0', foreground: '#123456', background: '#124578', cursor: '#12569a' });
    expect(term.options.theme!.extendedAnsi![200 - 16]).toBe('#ff0088');
    expect(yield* Schema.decodeUnknownEffect(ScreenAppearance)(JSON.parse(JSON.stringify(state)))).toEqual(state);
    replies.length = 0;
    yield* write(term, '\x1bc' + osc(4, '1;?'));
    expect((yield* appearance.snapshot()).colors).toEqual(state.colors);
    expect(replies).toEqual(['\x1b]4;1;rgb:a0a0/b0b0/c0c0\x1b\\']);
    yield* write(term, osc(104, '1') + osc(110) + osc(111) + osc(112));
    const partial = yield* appearance.snapshot();
    expect(partial.colors).toMatchObject({ foreground: base.foreground, background: base.background, cursor: base.cursor });
    expect(partial.colors.palette[1]).toBe(base.palette[1]);
    expect(partial.colors.palette[200]).toBe(0xff0088);
    yield* write(term, osc(104));
    expect((yield* appearance.snapshot()).colors).toEqual(base);
    expect(state.colors.palette[1]).toBe(0xa0b0c0);
  }),
);

it.live('split OSC payloads finish once and malformed color entries do not mutate or guess replies', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const replies: string[] = [];
    const appearance = yield* makeAppearance({ terminal: term, base, reply: (bytes) => replies.push(new TextDecoder().decode(bytes)) });
    yield* write(term, '\x1b]4;255;rgb:1234/5678/9abc');
    expect((yield* appearance.snapshot()).colors).toEqual(base);
    yield* write(term, '\x1b\\' + osc(4, '256;?;-1;?;2junk;?;2;red;3;rgb:f/ff/f;4;#abcd;255;?') + osc(10, 'rgbi:1/0/0'));
    expect((yield* appearance.snapshot()).colors.palette[255]).toBe(0x12569a);
    expect((yield* appearance.snapshot()).colors.palette.slice(0, 255)).toEqual(base.palette.slice(0, 255));
    expect(replies).toEqual(['\x1b]4;255;rgb:1212/5656/9a9a\x1b\\']);
  }),
);

it.live('cursor metadata follows public modes, normalized style and reset semantics while titles remain untrusted text', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const appearance = yield* makeAppearance({ terminal: term, base, reply: () => {} });
    yield* write(term, osc(2, 'application title') + '\x1b[3 q\x1b[?25l');
    expect(yield* appearance.snapshot()).toMatchObject({
      title: 'application title',
      cursor: { style: 'underline', blink: true, visible: false },
    });
    yield* write(term, '\x1b[!p');
    expect((yield* appearance.snapshot()).cursor).toEqual({ style: 'bar', blink: false, visible: true });
    yield* write(term, '\x1b[2 q\x1bc');
    expect((yield* appearance.snapshot()).cursor.style).toBe('bar');
    yield* write(term, '\x1b[5 q');
    expect((yield* appearance.snapshot()).cursor).toMatchObject({ style: 'bar', blink: true });
    yield* write(term, '\x1b[0 q');
    expect((yield* appearance.snapshot()).cursor).toMatchObject({ style: 'bar', blink: false });
  }),
);

it.live('reply sink failure is typed and interruption releases parser ownership', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const ready = yield* Deferred.make<Appearance, AppearanceUnavailable>();
    const replies: Uint8Array[] = [];
    const running = yield* Effect.forkScoped(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* makeAppearance({ terminal: term, base, reply: (bytes) => replies.push(bytes) }).pipe(
            Effect.tapError((error) => Deferred.fail(ready, error)),
          );
          yield* Deferred.succeed(ready, appearance);
          yield* Effect.never;
        }),
      ),
    );
    const released = yield* Deferred.await(ready);
    yield* Fiber.interrupt(running);
    yield* write(term, osc(4, '1;#ff0000;1;?'));
    expect(replies).toEqual([]);
    expect((yield* Effect.flip(released.snapshot()))._tag).toBe('AppearanceUnavailable');
    const appearance = yield* makeAppearance({
      terminal: term,
      base,
      reply: () => {
        throw new Error('sink unavailable');
      },
    });
    yield* write(term, osc(10, '?'));
    expect((yield* Effect.flip(appearance.snapshot()))._tag).toBe('AppearanceUnavailable');
  }),
);
