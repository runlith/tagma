import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Schema } from 'effect';
import { Terminal } from '@xterm/headless';
import { InputProfile } from '@runlith/executions/protocol/inputProfile';
import { makeInputModes, type InputModes, type InputProfileUnavailable } from './InputModes';

const terminal = () =>
  Effect.acquireRelease(
    Effect.sync(() => new Terminal({ cols: 8, rows: 2 })),
    (term) => Effect.sync(() => term.dispose()),
  );
const write = (term: Terminal, data: string) =>
  Effect.callback<void>((resume) => {
    term.write(new TextEncoder().encode(data), () => resume(Effect.void));
  });

it.live('normalized mixed parameters and split writes preserve authoritative modes and revision fences', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const modes = yield* makeInputModes({ terminal: term, profile: 'xterm-256color-unicode11' });
    const initial = yield* modes.require(0);
    yield* write(term, '\x1b[?1006:1016;1;66;2004;1004;1002');
    expect(yield* modes.snapshot()).toEqual(initial);
    yield* write(term, 'h');
    const changed = yield* modes.snapshot();
    expect(changed).toMatchObject({
      _tag: 'Available',
      applicationCursor: true,
      applicationKeypad: true,
      bracketedPaste: true,
      sendFocus: true,
      mouseTracking: 'drag',
      mouseEncoding: 'sgr',
    });
    expect(changed.revision).toBeGreaterThan(initial.revision);
    expect((yield* Effect.flip(modes.require(initial.revision)))._tag).toBe('InputProfileConflict');
    expect(changed).toEqual(yield* modes.require(changed.revision));
    expect(yield* Schema.decodeUnknownEffect(InputProfile)(JSON.parse(JSON.stringify(changed)))).toEqual(changed);
    expect(term.modes).toMatchObject({
      applicationCursorKeysMode: true,
      applicationKeypadMode: true,
      bracketedPasteMode: true,
      sendFocusMode: true,
      mouseTrackingMode: 'drag',
    });
    const reports: string[] = [];
    yield* Effect.acquireRelease(
      Effect.sync(() => term.onData((data) => reports.push(data))),
      (listener) => Effect.sync(() => listener.dispose()),
    );
    yield* write(term, '\x1b[?1006$p\x1b[?1016$p');
    expect(reports).toEqual(['\x1b[?1006;1$y', '\x1b[?1016;2$y']);
    expect((yield* modes.snapshot()).revision).toBe(changed.revision);
  }),
);

it.live('mouse encoding uses ordered setters and unconditional resets, and DECSTR differs from RIS', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const modes = yield* makeInputModes({ terminal: term, profile: 'xterm-256color-unicode11' });
    const reports: string[] = [];
    yield* Effect.acquireRelease(
      Effect.sync(() => term.onData((data) => reports.push(data))),
      (listener) => Effect.sync(() => listener.dispose()),
    );
    yield* write(term, '\x1b[?1006;1016;1003;2004h\x1b=');
    expect(yield* modes.snapshot()).toMatchObject({ mouseEncoding: 'sgr-pixels', mouseTracking: 'any', applicationKeypad: true });
    yield* write(term, '\x1b[!p\x1b[?1016$p\x1b[?1003$p');
    expect(yield* modes.snapshot()).toMatchObject({
      mouseEncoding: 'sgr-pixels',
      mouseTracking: 'any',
      applicationKeypad: false,
      bracketedPaste: false,
    });
    expect(reports.splice(0)).toEqual(['\x1b[?1016;1$y', '\x1b[?1003;1$y']);
    yield* write(term, '\x1b[?1006l\x1b[?1016$p');
    expect(yield* modes.snapshot()).toMatchObject({ mouseEncoding: 'default' });
    expect(reports.splice(0)).toEqual(['\x1b[?1016;2$y']);
    yield* write(term, '\x1b[?1016;1006h\x1b[?1006$p');
    expect(yield* modes.snapshot()).toMatchObject({ mouseEncoding: 'sgr' });
    expect(reports.splice(0)).toEqual(['\x1b[?1006;1$y']);
    yield* write(term, '\x1bc\x1b[?1006$p\x1b[?1003$p');
    expect(yield* modes.snapshot()).toMatchObject({ mouseEncoding: 'default', mouseTracking: 'none' });
    expect(reports).toEqual(['\x1b[?1006;2$y', '\x1b[?1003;2$y']);
    yield* write(term, '\x1b[?1016h');
    expect(yield* modes.snapshot()).toMatchObject({ mouseEncoding: 'sgr-pixels' });
    yield* Effect.sync(() => term.reset());
    yield* modes.reset();
    expect(yield* modes.snapshot()).toMatchObject({ mouseEncoding: 'default', mouseTracking: 'none' });
  }),
);

it.live('Unicode 11 widths and extension negotiation agree with the published basic input profile', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const modes = yield* makeInputModes({ terminal: term, profile: 'xterm-256color-unicode11' });
    const reports: string[] = [];
    yield* Effect.acquireRelease(
      Effect.sync(() => term.onData((data) => reports.push(data))),
      (listener) => Effect.sync(() => listener.dispose()),
    );
    yield* write(term, '\u{1f9d0}e\u0301\x1b[?9001h\x1b[>1u\x1b[?u\x1b[?9001$p');
    expect((yield* Effect.flip(modes.require(0)))._tag).toBe('InputProfileConflict');
    const profile = yield* modes.require(1);
    expect(profile.unicodeVersion).toBe('11');
    expect(profile.kittyKeyboardFlags).toBe(1);
    expect(term.buffer.active.getLine(0)!.getCell(0)!.getWidth()).toBe(2);
    expect(term.buffer.active.getLine(0)!.getCell(2)!.getChars()).toBe('e\u0301');
    expect(reports).toEqual(['\x1b[?1u', '\x1b[?9001;0$y']);
    expect(term.modes.win32InputMode).toBe(false);
    yield* Effect.sync(() => {
      term.unicode.activeVersion = '6';
    });
    expect((yield* modes.snapshot())._tag).toBe('Unavailable');
    expect((yield* Effect.flip(modes.require(1)))._tag).toBe('InputProfileUnavailable');
    yield* Effect.sync(() => {
      term.unicode.activeVersion = '11';
      term.options.allowProposedApi = false;
    });
    expect((yield* modes.snapshot())._tag).toBe('Unavailable');
    expect((yield* Effect.flip(modes.require(1)))._tag).toBe('InputProfileUnavailable');
    yield* Effect.sync(() => {
      term.options.allowProposedApi = true;
    });
    expect((yield* modes.require(1))._tag).toBe('Available');
  }),
);

it.live('negotiated keyboard state does not disappear when its permission is disabled', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const modes = yield* makeInputModes({ terminal: term, profile: 'xterm-256color-unicode11' });
    yield* Effect.sync(() => {
      term.options.vtExtensions = { win32InputMode: true };
    });
    expect((yield* modes.snapshot())._tag).toBe('Unavailable');
    yield* write(term, '\x1b[?9001h');
    yield* Effect.sync(() => {
      term.options.vtExtensions = { win32InputMode: false };
    });
    expect(term.modes.win32InputMode).toBe(true);
    expect((yield* Effect.flip(modes.require(0)))._tag).toBe('InputProfileUnavailable');
    yield* write(term, '\x1b[!p');
    expect((yield* modes.snapshot())._tag).toBe('Available');
  }),
);

it.live('a program pushing kitty keyboard flags moves the profile, and the flags it pushed are published', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const modes = yield* makeInputModes({ terminal: term, profile: 'xterm-256color-unicode11' });
    const before = yield* modes.snapshot();
    expect(before._tag === 'Available' ? before.kittyKeyboardFlags : -1).toBe(0);
    yield* write(term, '\x1b[>1u');
    const pushed = yield* modes.snapshot();
    expect(pushed._tag).toBe('Available');
    expect(pushed.revision).toBeGreaterThan(before.revision);
    expect(pushed._tag === 'Available' ? pushed.kittyKeyboardFlags : -1).toBe(1);
    yield* write(term, '\x1b[<1u');
    expect(yield* modes.snapshot()).toMatchObject({ _tag: 'Available', kittyKeyboardFlags: 0 });
    yield* write(term, '\x1b[>5u');
    expect(yield* modes.snapshot()).toMatchObject({ _tag: 'Available', kittyKeyboardFlags: 5 });
    yield* write(term, '\x1bc');
    expect(yield* modes.snapshot()).toMatchObject({ _tag: 'Available', kittyKeyboardFlags: 0 });
  }),
);

it.live('interruption withdraws the profile and releases its normalized parser hooks', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const ready = yield* Deferred.make<InputModes, InputProfileUnavailable>();
    const running = yield* Effect.forkScoped(
      Effect.scoped(
        Effect.gen(function* () {
          const modes = yield* makeInputModes({ terminal: term, profile: 'xterm-256color-unicode11' }).pipe(
            Effect.tapError((error) => Deferred.fail(ready, error)),
          );
          yield* Deferred.succeed(ready, modes);
          yield* Effect.never;
        }),
      ),
    );
    const released = yield* Deferred.await(ready);
    yield* Fiber.interrupt(running);
    const before = yield* released.snapshot();
    expect(before._tag).toBe('Unavailable');
    yield* write(term, '\x1b[?1;1006h');
    expect(term.modes.applicationCursorKeysMode).toBe(true);
    expect(yield* released.snapshot()).toEqual(before);
    expect((yield* Effect.flip(released.require(before.revision)))._tag).toBe('InputProfileUnavailable');
  }),
);

it.live('a joined emoji sequence advances one wide cell on the host, where plain Unicode 11 advances per half', () =>
  Effect.gen(function* () {
    const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
    const host = yield* terminal();
    yield* makeInputModes({ terminal: host, profile: 'xterm-256color-unicode11' });
    yield* write(host, family);
    const responder = host.buffer.active.cursorX;
    const plain = yield* terminal();
    yield* write(plain, family);
    expect(responder).toBe(2);
    expect(plain.buffer.active.cursorX).toBeGreaterThan(responder);
  }),
);

it.live('the profile says which screen stands, and entering or leaving it moves the revision', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    const modes = yield* makeInputModes({ terminal: term, profile: 'xterm-256color-unicode11' });
    const normal = yield* modes.snapshot();
    expect(normal).toMatchObject({ _tag: 'Available', alternateScreen: false });
    yield* write(term, '\x1b[?1049h');
    const alternate = yield* modes.snapshot();
    expect(alternate).toMatchObject({ _tag: 'Available', alternateScreen: true });
    expect(alternate.revision).toBeGreaterThan(normal.revision);
    expect((yield* Effect.flip(modes.require(normal.revision)))._tag).toBe('InputProfileConflict');
    yield* write(term, '\x1b[?1049l');
    const back = yield* modes.snapshot();
    expect(back).toMatchObject({ _tag: 'Available', alternateScreen: false });
    expect(back.revision).toBeGreaterThan(alternate.revision);
    expect(yield* Schema.decodeUnknownEffect(InputProfile)(JSON.parse(JSON.stringify(back)))).toEqual(back);
  }),
);

it.live('missing and unsupported profiles refuse semantic input with their recorded reason', () =>
  Effect.gen(function* () {
    const term = yield* terminal();
    for (const requested of [undefined, 'unknown-terminal']) {
      const modes = yield* makeInputModes({ terminal: term, profile: requested });
      const profile = yield* modes.snapshot();
      expect(profile._tag).toBe('Unavailable');
      if (profile._tag !== 'Unavailable') return;
      expect(profile.reason.length).toBeGreaterThan(0);
      expect(yield* Effect.flip(modes.require(profile.revision))).toMatchObject({
        _tag: 'InputProfileUnavailable',
        reason: profile.reason,
      });
      expect(yield* Schema.decodeUnknownEffect(InputProfile)(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
    }
  }),
);
