import { expect, test } from 'vitest';
import type { TerminalInputReceipt } from '@tagma/server/executions/contract/wire/viewLeases';
import { Host } from '@runlith/layer/Host';
import type { LiveConnection, LiveFailure, LiveStatus } from '$lib/wire/Live.js';
import { commitComposition, newComposition } from './engineGuards.js';
import { HOST_INPUT_ADMISSION_BYTES, IME_CHORD_ABANDON_MS, IME_NEWLINE_FALLBACK_MS, TerminalInput } from './Input.js';
import type { Engine } from './terminalEngine.js';
import { TerminalKeymap, type TerminalAct } from './Keymap.js';
import type { Writer } from './Output.js';
import type { ExecutionsRepo } from '../Repo.js';

type Repo = ReturnType<typeof ExecutionsRepo.use>;

const ESC = String.fromCharCode(0x1b);
const ETX = String.fromCharCode(0x03);
const INERT = '␛';
const START = `${ESC}[200~`;
const END = `${ESC}[201~`;

const address = { execution: 'exec-1', incarnation: 0 };
const VIEW = 'view-1';
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const drain = async () => {
  await settled();
  await settled();
  await settled();
};
const decode = (base64: string) => Buffer.from(base64, 'base64').toString('utf8');

const admitted = (sequence = 0) => ({
  _tag: 'InputAdmitted',
  receipt: { execution: 'exec-1', sequence, cause: 'raw', bytes: 1, acceptedThrough: '1' },
});

type InputCall = {
  readonly binding: string;
  readonly sequence: number;
  readonly act: { readonly _tag: string; readonly bytes?: string };
  readonly cause: string;
};

type SocketCall = {
  readonly projectId: number;
  readonly execution: string;
  readonly incarnation: number;
  readonly binding: string;
  readonly sequence: number;
  readonly act: { readonly _tag: string; readonly bytes?: Uint8Array };
  readonly cause: string;
};

const pageCall = (payload: SocketCall): InputCall => ({
  binding: payload.binding,
  sequence: payload.sequence,
  cause: payload.cause,
  act:
    payload.act._tag === 'Write'
      ? { _tag: 'Write', bytes: Buffer.from(payload.act.bytes ?? new Uint8Array()).toString('base64') }
      : { _tag: 'Interrupt' },
});

const terminalOver = () => {
  const held = {
    data: null as ((data: string) => void) | null,
    binary: null as ((data: string) => void) | null,
    key: null as ((event: KeyboardEvent) => boolean) | null,
    osc52: null as ((data: string) => boolean) | null,
    selection: '',
    cleared: 0,
  };
  const terminal = {
    options: { disableStdin: false },
    rows: 24,
    refresh: () => undefined,
    onData: (listener: (data: string) => void) => {
      held.data = listener;
      return {
        dispose: () => {
          if (held.data === listener) held.data = null;
        },
      };
    },
    onBinary: (listener: (data: string) => void) => {
      held.binary = listener;
      return {
        dispose: () => {
          if (held.binary === listener) held.binary = null;
        },
      };
    },
    attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => {
      held.key = handler;
    },
    getSelection: () => held.selection,
    hasSelection: () => held.selection !== '',
    clearSelection: () => {
      held.cleared += 1;
      held.selection = '';
    },
    parser: {
      registerOscHandler: (id: number, handler: (data: string) => boolean) => {
        if (id === 52) held.osc52 = handler;
        return { dispose: () => {} };
      },
    },
  };
  return { held, terminal };
};

type LaneCall = { readonly execution: string; readonly incarnation: number; readonly view?: string; readonly binding?: string };

type Behavior = {
  input?: (call: InputCall) => unknown;
  laneOpen?: (opened: number) => unknown;
};

const repoOver = (behavior: Behavior = {}, admission = HOST_INPUT_ADMISSION_BYTES) => {
  const doorOpens: LaneCall[] = [];
  const doorCloses: LaneCall[] = [];
  const inputCalls: InputCall[] = [];
  const laneOpens: { readonly projectId: number; readonly execution: string; readonly incarnation: number; readonly binding: string }[] =
    [];
  const laneFailures: ((failure: LiveFailure) => void)[] = [];
  const typed = { count: 0 };
  let status: LiveStatus = 'open';
  const statuses = new Set<(status: LiveStatus) => void>();
  const connection = (next: LiveStatus): void => {
    status = next;
    for (const listener of statuses) listener(next);
  };
  let laneListener: ((receipt: TerminalInputReceipt) => void) | null = null;
  const receiptListeners: ((receipt: TerminalInputReceipt) => void)[] = [];

  const outcomeFor = (call: InputCall): unknown => {
    const bytes = call.act.bytes === undefined ? 0 : Buffer.from(call.act.bytes, 'base64').length;
    if (bytes > admission) {
      return {
        _tag: 'InputBackpressure',
        frontier: { acceptedThrough: '0', pendingBytes: 0 },
        pendingBytes: 0,
        limit: admission,
      };
    }
    return behavior.input?.(call) ?? admitted(call.sequence);
  };

  const receiptOf = (call: InputCall, outcome: unknown): TerminalInputReceipt => {
    const held = outcome as { readonly _tag: string };
    const kind = held._tag === 'InputAdmitted' ? 'applied' : held._tag === 'InputBackpressure' ? 'backpressure' : 'refused';
    return { kind, sequence: call.sequence, outcome } as TerminalInputReceipt;
  };

  const answer = (call: InputCall): Promise<unknown> => {
    const outcome = outcomeFor(call);
    return outcome instanceof Promise ? (outcome as Promise<unknown>) : Promise.resolve(outcome);
  };

  const client = {
    'terminal.input.write': (payload: SocketCall) => {
      const call = pageCall(payload);
      inputCalls.push(call);
      return answer(call).then((outcome) => {
        laneListener?.(receiptOf(call, outcome));
        return { acknowledged: true as const };
      });
    },
    'terminal.input.receipts': (payload: unknown) => payload,
  };

  const repo = {
    laneOpen: {
      run: (payload: LaneCall) => {
        doorOpens.push(payload);
        return Promise.resolve(behavior.laneOpen?.(doorOpens.length) ?? { binding: `lane-${doorOpens.length}` });
      },
    },
    laneClose: {
      run: (payload: LaneCall) => {
        doorCloses.push(payload);
        return Promise.resolve({ closed: true });
      },
    },
    input: {
      run: (payload: InputCall) => {
        inputCalls.push(payload);
        return answer(payload);
      },
    },
  } as unknown as Repo;

  const live = {
    call: (work: (client: unknown) => unknown) => Promise.resolve(work(client)),
    hold: (
      open: (client: unknown) => unknown,
      onItem: (receipt: TerminalInputReceipt) => void,
      onFailure: (failure: LiveFailure) => void,
    ) => {
      laneOpens.push(open(client) as (typeof laneOpens)[number]);
      laneListener = onItem;
      receiptListeners.push(onItem);
      laneFailures.push(onFailure);
      return {
        unsubscribe: () => {
          if (laneListener === onItem) laneListener = null;
        },
      };
    },
    subscribeStatus: (listener: (status: LiveStatus) => void) => {
      statuses.add(listener);
      listener(status);
      return () => statuses.delete(listener);
    },
    get status() {
      return status;
    },
  } as unknown as LiveConnection;

  const writer = {
    typed: () => {
      typed.count += 1;
    },
  } as unknown as Writer;

  return {
    repo,
    live,
    writer,
    inputCalls,
    doorOpens,
    doorCloses,
    receiptListeners,
    laneOpens,
    laneFailures,
    typed,
    connection,
  };
};

const clipboardOver = () => {
  const written: string[] = [];
  let stored = '';
  let picture: Blob | null = null;
  let denyWrite = false;
  let denyRead = false;
  return {
    written,
    store: (text: string) => {
      stored = text;
    },
    storePicture: (held: Blob) => {
      picture = held;
    },
    denyWrites: () => {
      denyWrite = true;
    },
    denyReads: () => {
      denyRead = true;
    },
    clipboard: {
      readText: () => (denyRead ? Promise.reject(new Error('denied')) : Promise.resolve(stored)),
      readPicture: () => (denyRead ? Promise.reject(new Error('denied')) : Promise.resolve(picture)),
      writeText: (text: string) => {
        if (denyWrite) return Promise.reject(new Error('denied'));
        written.push(text);
        return Promise.resolve();
      },
    },
  };
};

const clockOver = () => {
  const waits: { ms: number; resolve: () => void }[] = [];
  let reading = 0;
  return {
    waits,
    at: (value: number) => {
      reading = value;
    },
    clock: {
      wait: (ms: number) =>
        new Promise<void>((resolve) => {
          waits.push({ ms, resolve });
        }),
      now: () => reading,
    },
  };
};

const elapse = (clock: { waits: { ms: number; resolve: () => void }[] }): void => {
  for (const wait of clock.waits.splice(0)) wait.resolve();
};

const setup = (
  behavior: Behavior = {},
  options: {
    osc52?: boolean;
    replaying?: () => boolean;
    admission?: number;
    os?: 'linux' | 'macos';
    candidateKeysArrivePlain?: boolean;
    focused?: () => boolean;
    taken?: (act: TerminalAct) => boolean;
  } = {},
) => {
  const term = terminalOver();
  const engine = { terminal: term.terminal } as unknown as Engine;
  const keymap = new TerminalKeymap(new Host('tab', options.os ?? 'linux'));
  const clipboard = clipboardOver();
  const clock = clockOver();
  const problems: string[] = [];
  const endings: number[] = [];
  const acts: TerminalAct[] = [];
  const admission = options.admission ?? HOST_INPUT_ADMISSION_BYTES;
  const repo = repoOver(behavior, admission);
  const composition = newComposition();
  const input = new TerminalInput(engine, repo.repo, keymap, clipboard.clipboard, clock.clock, repo.live, repo.writer, 1, admission, {
    osc52: options.osc52 ?? true,
    replaying: options.replaying,
    onProblem: (problem: string) => {
      problems.push(problem);
    },
    onEnded: () => endings.push(1),
    composition,
    candidateKeysArrivePlain: options.candidateKeysArrivePlain,
    focused: options.focused,
  });
  input.onAct((act) => {
    acts.push(act);
    return options.taken?.(act) ?? true;
  });
  input.attach(address, VIEW);
  return { ...term, engine, keymap, clipboard, clock, problems, endings, acts, composition, ...repo, input };
};

const keydown = (held: { key: ((event: KeyboardEvent) => boolean) | null }, event: object): boolean => browserKeydown(held, event).handled;

const browserKeydown = (held: { key: ((event: KeyboardEvent) => boolean) | null }, event: object) => {
  if (!held.key) throw new Error('no key handler installed');
  const delivered = {
    type: 'keydown',
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      delivered.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      delivered.propagationStopped = true;
    },
    ...event,
  };
  const handled = held.key(delivered as unknown as KeyboardEvent);
  return { handled, prevented: delivered.defaultPrevented, stopped: delivered.propagationStopped };
};

test('two hundred one-byte keystrokes become one write of two hundred bytes in order', async () => {
  const t = setup();
  await drain();
  const chars = Array.from({ length: 200 }, (_, index) => String.fromCharCode(97 + (index % 26)));
  for (const char of chars) t.held.data?.(char);
  await drain();
  expect(t.inputCalls.length).toBe(1);
  expect(decode(t.inputCalls[0]?.act.bytes ?? '')).toBe(chars.join(''));
  expect(t.inputCalls[0]?.cause).toBe('typed');
  expect(t.inputCalls[0]?.sequence).toBe(0);
  expect(t.inputCalls[0]?.binding).toBe('lane-1');
});

test('a cursor report the engine composed reaches no write, and a keystroke beside it still does', async () => {
  const t = setup();
  await drain();
  t.held.data?.(`${ESC}[6;1R`);
  t.held.data?.('a');
  await drain();
  expect(t.inputCalls.length).toBe(1);
  expect(decode(t.inputCalls[0]?.act.bytes ?? '')).toBe('a');
});

test('every one of the seven reply grammars is dropped, consecutive replies included', async () => {
  const t = setup();
  await drain();
  const replies = [
    `${ESC}[6;1R`,
    `${ESC}[0n`,
    `${ESC}[?62;c`,
    `${ESC}[4;600;800t`,
    `${ESC}[?2004;1$y`,
    `${ESC}[?7u`,
    `${ESC}]11;rgb:0000/0000/0000${ESC}\\`,
    `${ESC}P1$r2 q${ESC}\\`,
    `${ESC}[6;1R${ESC}[?997;1n`,
  ];
  for (const reply of replies) t.held.data?.(reply);
  await drain();
  expect(t.inputCalls.length).toBe(0);
  t.held.data?.(`${ESC}[97;5u`);
  t.held.data?.(`${ESC}[6;1Rls`);
  await drain();
  const bodies = t.inputCalls.map((call) => decode(call.act.bytes ?? ''));
  expect(bodies.join('')).toBe(`${ESC}[97;5u${ESC}[6;1Rls`);
});

test('a paste while observing is refused and is not carried into the next writable binding', async () => {
  const t = setup();
  t.input.observe();
  const refused = t.input.paste('observed-only');
  t.input.attach({ execution: 'exec-2', incarnation: 0 }, VIEW);
  expect(await t.input.paste('writable')).toBe(true);
  expect(await refused).toBe(false);
  expect(t.inputCalls.map((call) => decode(call.act.bytes ?? ''))).toEqual(['writable']);
});

test('a pasted terminator arrives inert inside the bracketed frame', async () => {
  const t = setup();
  await drain();
  t.input.setBracketedPaste(true);
  expect(await t.input.paste(`run ${ESC}[201~ now`)).toBe(true);
  await drain();
  expect(t.inputCalls.length).toBe(1);
  expect(decode(t.inputCalls[0]?.act.bytes ?? '')).toBe(`${START}run ${INERT}[201~ now${END}`);
});

test('pieces pasted together each take their own frame, even after Ctrl+C, with the gap typed between and after them', async () => {
  const t = setup();
  await drain();
  t.input.setBracketedPaste(true);
  expect(keydown(t.held, { key: 'c', code: 'KeyC', ctrlKey: true })).toBe(false);
  await drain();
  expect(await t.input.pasteEach(['/tmp/a.png', '/tmp/b.png'], ' ')).toBe(true);
  await drain();
  expect(t.inputCalls.map((call) => decode(call.act.bytes ?? '')).join('')).toBe(`${START}/tmp/a.png${END} ${START}/tmp/b.png${END} `);
});

test('a single-line paste after Ctrl+C bypasses the stale wrappers, a multiline one still wraps', async () => {
  const t = setup();
  await drain();
  t.input.setBracketedPaste(true);
  expect(keydown(t.held, { key: 'c', code: 'KeyC', ctrlKey: true })).toBe(false);
  expect(t.acts).toEqual([]);
  await drain();
  expect(t.inputCalls[0]?.act).toEqual({ _tag: 'Interrupt' });
  expect(t.inputCalls[0]?.cause).toBe('interrupt');
  expect(await t.input.paste('ls -la')).toBe(true);
  await drain();
  expect(decode(t.inputCalls[1]?.act.bytes ?? '')).toBe('ls -la');
  expect(await t.input.paste('a\nb')).toBe(true);
  await drain();
  expect(decode(t.inputCalls[2]?.act.bytes ?? '')).toBe(`${START}a\rb${END}`);
  expect(await t.input.paste('ls -la')).toBe(true);
  await drain();
  expect(decode(t.inputCalls[3]?.act.bytes ?? '')).toBe(`${START}ls -la${END}`);
});

test('a clipboard paste with no text hands the picture to the pane that takes one, and text still goes as text', async () => {
  const t = setup();
  await drain();
  const shot = new Blob(['png'], { type: 'image/png' });
  t.clipboard.storePicture(shot);
  const handed: Blob[] = [];
  const take = async (held: Blob) => (handed.push(held), true);
  expect(await t.input.pasteFromClipboard(take)).toBe(true);
  expect(handed).toEqual([shot]);
  expect(await t.input.pasteFromClipboard()).toBe(true);
  t.clipboard.store('ls');
  expect(await t.input.pasteFromClipboard(take)).toBe(true);
  await drain();
  expect(handed).toEqual([shot]);
  expect(t.inputCalls.map((call) => decode(call.act.bytes ?? ''))).toEqual(['ls']);
});

test('a copy keeps the selection, whether the clipboard took it or refused', async () => {
  const t = setup();
  t.held.selection = 'hello';
  expect(await t.input.copy()).toBe(true);
  expect(t.clipboard.written).toEqual(['hello']);
  expect(t.held.cleared).toBe(0);
  expect(t.held.selection).toBe('hello');
  t.clipboard.denyWrites();
  t.held.selection = 'again';
  expect(await t.input.copy()).toBe(false);
  expect(t.held.cleared).toBe(0);
  expect(t.held.selection).toBe('again');
});

test('acts stand unanswered together: the next keystroke does not wait for the one before it', async () => {
  const slow = Promise.withResolvers<unknown>();
  let first = true;
  const t = setup({
    input: (call) => {
      if (!first) return admitted(call.sequence);
      first = false;
      return slow.promise;
    },
  });
  await drain();
  for (const key of ['a', 'b', 'c', 'd']) {
    t.held.data?.(key);
    await settled();
  }
  expect(t.inputCalls.map((call) => call.sequence)).toEqual([0, 1, 2, 3]);
  expect(t.inputCalls.map((call) => decode(call.act.bytes ?? ''))).toEqual(['a', 'b', 'c', 'd']);
  slow.resolve(admitted(0));
  await drain();
});

test('a paste larger than one admission is cut to it, markers counted, and the frame arrives whole', async () => {
  const t = setup();
  await drain();
  t.input.setBracketedPaste(true);
  const payload = 'z'.repeat(17 * 1024);
  expect(await t.input.paste(payload)).toBe(true);
  await drain();
  const bodies = t.inputCalls.map((call) => decode(call.act.bytes ?? ''));
  expect(bodies.length).toBe(2);
  for (const body of bodies) expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(HOST_INPUT_ADMISSION_BYTES);
  expect(bodies.join('')).toBe(`${START}${payload}${END}`);
  expect(t.inputCalls.every((call) => call.cause === 'paste')).toBe(true);
  expect(t.inputCalls.map((call) => call.sequence)).toEqual([0, 1]);
});

test('typing is cut to the admission too, and a multi-byte character is never split', async () => {
  const t = setup({}, { admission: 4 });
  await drain();
  t.held.data?.('ééé');
  await drain();
  const bodies = t.inputCalls.map((call) => decode(call.act.bytes ?? ''));
  expect(bodies.join('')).toBe('ééé');
  for (const body of bodies) expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(4);
  expect(bodies.every((body) => !body.includes('\ufffd'))).toBe(true);
});

test('an act the gate can never admit is a refusal, not pressure: one round, a problem, no retry', async () => {
  const t = setup({}, { admission: 64 * 1024 });
  const gate = repoOver({}, 16 * 1024);
  const narrow = new TerminalInput(
    { terminal: t.terminal } as unknown as Engine,
    gate.repo,
    t.keymap,
    t.clipboard.clipboard,
    t.clock.clock,
    gate.live,
    gate.writer,
    1,
    64 * 1024,
    { onProblem: (problem: string) => t.problems.push(problem) },
  );
  narrow.attach(address, VIEW);
  await drain();
  const pasted = narrow.paste('q'.repeat(20 * 1024));
  await drain();
  expect(gate.inputCalls.length).toBe(1);
  expect(await pasted).toBe(false);
  expect(t.clock.waits.some((wait) => wait.ms === 20)).toBe(false);
  expect(t.problems.some((problem) => problem.includes('16384'))).toBe(true);
  const before = gate.inputCalls.length;
  expect(await narrow.paste('w'.repeat(20 * 1024))).toBe(true);
  await drain();
  for (const call of gate.inputCalls.slice(before)) {
    expect(Buffer.from(call.act.bytes ?? '', 'base64').length).toBeLessThanOrEqual(16 * 1024);
  }
});

test('a paste the door answered nothing to is offered once, and the next intake offers it again under the same number', async () => {
  let silent = true;
  const t = setup({ input: (call) => (call.cause === 'paste' && silent ? Promise.resolve(undefined) : undefined) });
  await drain();
  const pasted = t.input.paste('ls');
  await drain();
  expect(t.inputCalls.filter((call) => call.cause === 'paste')).toHaveLength(1);

  silent = false;
  t.held.data?.('x');
  await drain();
  expect(await pasted).toBe(true);
  const [first, again, typed] = t.inputCalls;
  expect([again?.cause, again?.sequence]).toEqual(['paste', first?.sequence]);
  expect(typed?.sequence).toBe((first?.sequence ?? 0) + 1);
});

test('a paste the gate never admits fails at thirty seconds and sends nothing more', async () => {
  const t = setup({ input: () => new Promise(() => {}) });
  await drain();
  t.input.setBracketedPaste(true);
  const done = t.input.paste('y'.repeat(70 * 1024));
  await settled();
  expect(t.inputCalls.length).toBe(1);
  expect(t.clock.waits.map((wait) => wait.ms)).toContain(30_000);
  for (const wait of t.clock.waits.splice(0)) wait.resolve();
  expect(await done).toBe(false);
  await drain();
  expect(t.inputCalls.length).toBe(1);
});

test('OSC 52 writes land by default, reads never leave, and a replay never reaches the clipboard', async () => {
  const t = setup();
  await drain();
  expect(t.held.osc52?.('c;aGVsbG8=')).toBe(true);
  await drain();
  expect(t.clipboard.written).toEqual(['hello']);
  expect(t.held.osc52?.('c;?')).toBe(true);
  await drain();
  expect(t.clipboard.written).toEqual(['hello']);
  const off = setup({}, { osc52: false });
  await drain();
  expect(off.held.osc52?.('c;aGVsbG8=')).toBe(true);
  await drain();
  expect(off.clipboard.written).toEqual([]);
  const replaying = setup({}, { replaying: () => true });
  await drain();
  expect(replaying.held.osc52?.('c;aGVsbG8=')).toBe(true);
  await drain();
  expect(replaying.clipboard.written).toEqual([]);
});

test('a chord the pane claims becomes its act and types nothing', async () => {
  const t = setup();
  await drain();
  expect(keydown(t.held, { key: 'k', code: 'KeyK', ctrlKey: true })).toBe(false);
  expect(t.acts).toEqual([{ _tag: 'clear' }]);
  t.held.selection = 'x';
  expect(keydown(t.held, { key: 'c', code: 'KeyC', ctrlKey: true })).toBe(false);
  expect(t.acts).toEqual([{ _tag: 'clear' }, { _tag: 'copy' }]);
  expect(keydown(t.held, { key: 'a', code: 'KeyA' })).toBe(true);
  await drain();
  expect(t.inputCalls.length).toBe(0);
});

test('a chord the pane does not take stays with the page and types nothing', async () => {
  const t = setup({}, { taken: (act) => act._tag !== 'focus-previous' });
  await drain();
  expect(browserKeydown(t.held, { key: '[', code: 'BracketLeft', ctrlKey: true })).toEqual({
    handled: false,
    prevented: false,
    stopped: false,
  });
  expect(t.acts).toEqual([{ _tag: 'focus-previous' }]);
  await drain();
  expect(t.inputCalls.length).toBe(0);
});

test('a detach keeps the lane, so a pane that moves types on without opening another', async () => {
  const t = setup();
  await drain();
  t.held.data?.('a');
  await drain();
  t.input.detach();
  t.input.attach(address, VIEW);
  await drain();
  t.held.data?.('b');
  await drain();
  expect(t.doorOpens).toHaveLength(1);
  expect(t.inputCalls.map((call) => [call.binding, call.sequence])).toEqual([
    ['lane-1', 0],
    ['lane-1', 1],
  ]);
});

test('release closes the lane at the door once, and a second release sends nothing', async () => {
  const t = setup();
  await drain();
  t.held.data?.('a');
  await drain();
  await t.input.release();
  await drain();
  expect(t.doorCloses).toEqual([{ ...address, binding: 'lane-1' }]);
  await t.input.release();
  await drain();
  expect(t.doorCloses).toHaveLength(1);
});

test('backpressure retries the same act under the same sequence', async () => {
  let refusals = 0;
  const t = setup({
    input: () => {
      refusals += 1;
      return refusals === 1 ? { _tag: 'InputBackpressure', frontier: null, pendingBytes: 0, limit: 64 * 1024 } : admitted(0);
    },
  });
  await drain();
  t.held.data?.('a');
  await settled();
  expect(t.inputCalls.length).toBe(1);
  expect(t.clock.waits.length).toBe(1);
  for (const wait of t.clock.waits.splice(0)) wait.resolve();
  await drain();
  expect(t.inputCalls.length).toBe(2);
  expect(t.inputCalls.map((call) => call.sequence)).toEqual([0, 0]);
});

test('an attach to another execution opens a lane there at the next keystroke, counting from zero', async () => {
  const t = setup();
  await drain();
  t.held.data?.('a');
  await drain();

  t.input.attach({ execution: 'exec-2', incarnation: 0 }, VIEW);
  t.held.data?.('ls');
  await drain();
  expect(t.doorOpens.map((open) => open.execution)).toEqual(['exec-1', 'exec-2']);
  expect(t.inputCalls.at(-1)?.binding).toBe('lane-2');
  expect(decode(t.inputCalls.at(-1)?.act.bytes ?? '')).toBe('ls');
  expect(t.inputCalls.at(-1)?.sequence).toBe(0);
});

test('a keystroke into an ended shell does not stop typing into the shell that replaces it', async () => {
  const t = setup({ input: () => ({ _tag: 'InputEnded' }) });
  await drain();
  t.held.data?.('a');
  await drain();
  t.held.data?.('a');
  await drain();
  expect(t.inputCalls).toHaveLength(1);
  expect(await t.input.paste('x')).toBe(false);

  t.input.attach({ execution: 'exec-2', incarnation: 0 }, VIEW);
  await drain();
  const before = t.inputCalls.length;
  t.held.data?.('b');
  await drain();
  expect(t.inputCalls.length).toBe(before + 1);
  expect(decode(t.inputCalls.at(-1)?.act.bytes ?? '')).toBe('b');
});

const noGrant = { code: 'terminal-no-grant', reason: 'this call was prepared without the live interactive grant it rides' };

test('an interrupt the host cannot send falls back to the byte, and says nothing about it', async () => {
  const t = setup({
    input: (call) =>
      call.act._tag === 'Interrupt'
        ? { _tag: 'InputUnsupported', act: 'interrupt', reason: 'isig-disabled', detail: 'the child turned ISIG off' }
        : admitted(call.sequence),
  });
  await drain();
  expect(keydown(t.held, { key: 'c', code: 'KeyC', ctrlKey: true })).toBe(false);
  await drain();

  expect(t.inputCalls.map((call) => call.act._tag)).toEqual(['Interrupt', 'Write']);
  expect(decode(t.inputCalls[1]?.act.bytes ?? '')).toBe(ETX);
  expect(t.problems).toEqual([]);
});

test('a chord typed into a composition waits for the commit and lands behind the composed text', async () => {
  const t = setup();
  await drain();
  t.composition.startedAt = 0;
  expect(keydown(t.held, { key: 'ArrowLeft', ctrlKey: true })).toBe(false);
  await drain();
  expect(t.inputCalls.length).toBe(0);
  expect(t.clock.waits.map((wait) => wait.ms)).toEqual([IME_CHORD_ABANDON_MS]);

  commitComposition(1, t.composition);
  elapse(t.clock);
  await drain();

  expect(t.inputCalls.length).toBe(1);
  expect(decode(t.inputCalls[0]?.act.bytes ?? '')).toBe(`${ESC}b`);
});

test('Shift+Enter is CSI 13;2u once the program pushed kitty flags, and ESC CR before', async () => {
  const t = setup();
  await drain();
  const enter = browserKeydown(t.held, { key: 'Enter', shiftKey: true });
  expect(enter.handled).toBe(false);
  expect(enter.prevented).toBe(true);
  expect(enter.stopped).toBe(true);
  await drain();
  expect(decode(t.inputCalls[0]?.act.bytes ?? '')).toBe(`${ESC}\r`);

  (t.terminal as unknown as { _core: unknown })._core = { coreService: { kittyKeyboard: { flags: 1 } } };
  expect(keydown(t.held, { key: 'Enter', shiftKey: true })).toBe(false);
  await drain();
  expect(decode(t.inputCalls[1]?.act.bytes ?? '')).toBe(`${ESC}[13;2u`);
});

test('a newline held for a composition goes anyway after 200 ms; a chord is dropped after ten seconds', async () => {
  const t = setup();
  await drain();
  t.composition.startedAt = 0;
  expect(keydown(t.held, { key: 'Enter', shiftKey: true })).toBe(false);
  expect(keydown(t.held, { key: 'ArrowLeft', ctrlKey: true })).toBe(false);
  expect(t.clock.waits.map((wait) => wait.ms)).toEqual([IME_NEWLINE_FALLBACK_MS, IME_CHORD_ABANDON_MS]);

  elapse(t.clock);
  await drain();
  elapse(t.clock);
  await drain();

  const bodies = t.inputCalls.map((call) => decode(call.act.bytes ?? ''));
  expect(bodies).toEqual([`${ESC}\r`]);
  commitComposition(60_000, t.composition);
  elapse(t.clock);
  await drain();
  expect(t.inputCalls.length).toBe(1);
});

test('a chord held when the pane detaches is dropped, not flushed into the next attachment', async () => {
  const t = setup();
  await drain();
  t.composition.startedAt = 0;
  expect(keydown(t.held, { key: 'ArrowLeft', ctrlKey: true })).toBe(false);

  t.input.detach();
  t.input.attach(address, VIEW);
  await drain();
  commitComposition(1, t.composition);
  elapse(t.clock);
  await drain();

  expect(t.inputCalls.length).toBe(0);
});

test('the key that confirmed a candidate is the input method’s, not text for the child', async () => {
  const t = setup({}, { candidateKeysArrivePlain: true });
  await drain();
  commitComposition(0, t.composition);
  t.clock.at(100);
  expect(keydown(t.held, { key: ' ' })).toBe(false);
  expect(keydown(t.held, { key: '2' })).toBe(false);
  t.clock.at(251);
  expect(keydown(t.held, { key: ' ' })).toBe(true);
  t.clock.at(100);
  expect(keydown(t.held, { key: ' ', shiftKey: true })).toBe(true);
  await drain();
  expect(t.inputCalls.length).toBe(0);

  const mac = setup({}, { os: 'macos' });
  await drain();
  commitComposition(0, mac.composition);
  mac.clock.at(100);
  expect(keydown(mac.held, { key: ' ' })).toBe(true);
});

test('a keystroke the input method consumed resolves to no chord', async () => {
  const t = setup({}, { os: 'macos' });
  await drain();
  expect(keydown(t.held, { key: 'Process', keyCode: 229, code: 'KeyA', altKey: true })).toBe(true);
  t.composition.startedAt = 0;
  expect(keydown(t.held, { key: '', code: 'KeyK', metaKey: true, isComposing: true })).toBe(true);
  await drain();
  expect(t.acts).toEqual([]);
  expect(t.inputCalls.length).toBe(0);
});

const connectionLost = { code: 'transport', reason: 'connection lost' };

test.each(['before admission', 'after admission'])('connection loss %s recovers ordered input without duplicating it', async (failure) => {
  const receipts = new Map<number, InputCall>();
  const written: string[] = [];
  let disconnected = false;
  const t = setup({
    input: (call) => {
      const prior = receipts.get(call.sequence);
      if (prior !== undefined) {
        return JSON.stringify(prior) === JSON.stringify(call)
          ? admitted(call.sequence)
          : { _tag: 'InputConflict', sequence: call.sequence };
      }
      if (!disconnected && failure === 'before admission') {
        disconnected = true;
        return Promise.reject(connectionLost);
      }
      receipts.set(call.sequence, call);
      written.push(decode(call.act.bytes ?? ''));
      if (!disconnected) {
        disconnected = true;
        return Promise.reject(connectionLost);
      }
      return admitted(call.sequence);
    },
  });
  await drain();
  t.held.data?.('first');
  await drain();
  t.held.data?.('second');
  await drain();
  elapse(t.clock);
  await drain();
  expect(written.join('')).toBe('firstsecond');
  expect(t.doorOpens).toHaveLength(1);
  expect([...receipts.keys()]).toEqual([0, 1]);
});

test('repeated connection failures keep one paced recovery and release cancels it', async () => {
  const t = setup({ input: () => Promise.reject(connectionLost) });
  await drain();
  t.held.data?.('a');
  await drain();
  expect(t.inputCalls).toHaveLength(1);
  expect(t.clock.waits).toHaveLength(1);
  elapse(t.clock);
  await drain();
  expect(t.inputCalls).toHaveLength(2);
  expect(t.clock.waits).toHaveLength(1);
  await t.input.release();
  elapse(t.clock);
  await drain();
  expect(t.inputCalls).toHaveLength(2);
});

test('a late response from a replaced execution cannot change the new input sequence', async () => {
  const waiting = Promise.withResolvers<unknown>();
  let first = true;
  const t = setup({
    input: (call) => {
      if (!first) return admitted(call.sequence);
      first = false;
      return waiting.promise;
    },
  });
  await drain();
  t.held.data?.('old');
  await drain();
  t.input.attach({ execution: 'exec-2', incarnation: 0 }, VIEW);
  t.held.data?.('new');
  await drain();
  waiting.resolve(admitted(0));
  await drain();
  expect(t.inputCalls.map((call) => [decode(call.act.bytes ?? ''), call.sequence])).toEqual([
    ['old', 0],
    ['new', 0],
  ]);
});

test('a pane moved while its answer was lost still resends the act under the identity it left with', async () => {
  const receipts = new Map<number, InputCall>();
  const written: string[] = [];
  let disconnected = true;
  const t = setup({
    input: (call) => {
      const prior = receipts.get(call.sequence);
      if (prior !== undefined) {
        return JSON.stringify(prior) === JSON.stringify(call)
          ? admitted(call.sequence)
          : { _tag: 'InputConflict', sequence: call.sequence };
      }
      receipts.set(call.sequence, call);
      written.push(decode(call.act.bytes ?? ''));
      if (disconnected) return Promise.reject(connectionLost);
      return admitted(call.sequence);
    },
  });
  await drain();
  t.held.data?.('typed');
  await drain();
  t.input.detach();
  t.input.attach(address, VIEW);
  await drain();
  disconnected = false;
  elapse(t.clock);
  await drain();
  expect(written).toEqual(['typed']);
  expect(t.inputCalls.length).toBe(2);
  t.held.data?.('more');
  await drain();
  expect(written).toEqual(['typed', 'more']);
});

test.each(['typed', 'paste'])('input %s held by a yielding logic continues in order when its successor admits it', async (cause) => {
  let yielding = true;
  const written: string[] = [];
  const t = setup({
    input: (call) => {
      if (yielding) return Promise.reject({ code: 'terminal-host-refused-InputYielding', reason: 'logic handover' });
      written.push(decode(call.act.bytes ?? ''));
      return admitted(call.sequence);
    },
  });
  const pasted = cause === 'paste' ? t.input.paste('first') : null;
  if (cause === 'typed') t.held.data?.('first');
  await drain();
  yielding = false;
  for (const wait of t.clock.waits.splice(0).filter((wait) => wait.ms === 20)) wait.resolve();
  await drain();
  if (pasted !== null) expect(await pasted).toBe(true);
  t.held.data?.('second');
  await drain();
  expect(written).toEqual(['first', 'second']);
  expect(t.endings).toEqual([]);
  expect(t.problems).toEqual([]);
});

test.each(['open', 'closed'] as const)(
  'typing queued before the first lane survives transport loss with the live socket %s',
  async (status) => {
    const written: string[] = [];
    const t = setup({
      laneOpen: (opened) => (opened === 1 ? Promise.reject(connectionLost) : undefined),
      input: (call) => {
        written.push(decode(call.act.bytes ?? ''));
        return admitted(call.sequence);
      },
    });
    t.connection(status);
    t.held.data?.('queued');
    await drain();
    elapse(t.clock);
    await drain();
    if (status === 'closed') t.connection('open');
    await drain();
    expect(written).toEqual(['queued']);
    expect(t.problems).toEqual([]);
  },
);

test('an ended input refuses all later typing into that execution, and opens no lane again', async () => {
  const t = setup({ input: () => ({ _tag: 'InputEnded' }) });
  await drain();
  t.held.data?.('a');
  await drain();
  expect(t.inputCalls.length).toBe(1);
  t.held.data?.('b');
  await drain();
  expect(t.inputCalls.length).toBe(1);
  expect(t.doorOpens).toHaveLength(1);
  expect(await t.input.paste('c')).toBe(false);
  expect(t.endings).toEqual([1]);
});

test('a view opens nothing until it is focused or typed into, and what was typed first rides the lane it opened', async () => {
  const opened = Promise.withResolvers<unknown>();
  const t = setup({ laneOpen: () => opened.promise });
  await drain();
  expect(t.doorOpens).toEqual([]);
  t.input.focused();
  t.held.data?.('ls');
  t.input.focused();
  await drain();
  expect(t.doorOpens).toEqual([{ ...address, view: VIEW }]);
  expect(t.inputCalls).toEqual([]);

  opened.resolve({ binding: 'lane-1' });
  await drain();
  expect(t.inputCalls.map((call) => [call.binding, call.sequence, decode(call.act.bytes ?? '')])).toEqual([['lane-1', 0, 'ls']]);
});

const laneRefusals: [string, (call: InputCall) => unknown][] = [
  ['a grant the server no longer holds', () => Promise.reject(noGrant)],
  ['a binding the host no longer holds', () => Promise.reject({ code: 'terminal-host-refused-HostConflict', reason: 'BindingUnknown' })],
  ['a conflict at the gate', (call) => ({ _tag: 'InputConflict', sequence: call.sequence })],
];

test.each(laneRefusals)(
  '%s reopens a lane that typed without a word, and the act it took nothing for goes on the new lane',
  async (_refusal, refuse) => {
    const typed: [string, number, string][] = [];
    const t = setup({
      input: (call) => {
        if (call.binding === 'lane-1' && call.sequence > 0) return refuse(call);
        typed.push([call.binding, call.sequence, decode(call.act.bytes ?? '')]);
        return admitted(call.sequence);
      },
    });
    await drain();
    t.held.data?.('a');
    await drain();
    t.held.data?.('b');
    await drain();
    await drain();

    expect(typed).toEqual([
      ['lane-1', 0, 'a'],
      ['lane-2', 0, 'b'],
    ]);
    expect(t.doorOpens).toHaveLength(2);
    expect(t.problems).toEqual([]);
  },
);

test('a reopened lane refused before it typed anything says the server’s sentence and stops; the next keystroke opens a lane again', async () => {
  const typed: string[] = [];
  const t = setup({
    input: (call) => {
      if (call.binding !== 'lane-3') return Promise.reject(noGrant);
      typed.push(decode(call.act.bytes ?? ''));
      return admitted(call.sequence);
    },
  });
  await drain();
  t.held.data?.('a');
  await drain();
  await drain();
  expect(t.doorOpens).toHaveLength(2);
  expect(t.problems).toEqual([noGrant.reason]);

  t.held.data?.('b');
  await drain();
  await drain();
  expect(t.doorOpens).toHaveLength(3);
  expect(typed).toEqual(['b']);
});

test('what a lost connection left unconfirmed is settled lost and said once when its lane is refused, and never typed on the new lane', async () => {
  const written: string[] = [];
  let attempts = 0;
  const t = setup({
    input: (call) => {
      if (attempts++ === 0) {
        written.push(decode(call.act.bytes ?? ''));
        return Promise.reject(connectionLost);
      }
      if (call.binding === 'lane-1') return Promise.reject(noGrant);
      written.push(decode(call.act.bytes ?? ''));
      return admitted(call.sequence);
    },
  });
  await drain();
  t.held.data?.('run\r');
  await drain();
  t.held.data?.('stale tail');
  elapse(t.clock);
  await drain();
  await drain();
  expect(written).toEqual(['run\r']);
  expect(t.problems).toHaveLength(1);

  t.held.data?.('fresh');
  await drain();
  expect(written).toEqual(['run\r', 'fresh']);
  expect(t.doorOpens).toHaveLength(2);
});

test('an expired receipt settles the window lost, says it once, and typing goes on through a fresh lane', async () => {
  const typed: [string, string][] = [];
  const t = setup({
    input: (call) => {
      if (call.binding === 'lane-1' && call.sequence === 1) {
        return { _tag: 'InputReceiptExpired', sequence: 1, retainedFrom: 2 };
      }
      typed.push([call.binding, decode(call.act.bytes ?? '')]);
      return admitted(call.sequence);
    },
  });
  await drain();
  t.held.data?.('a');
  await drain();
  t.held.data?.('b');
  await drain();
  await drain();
  expect(t.problems).toHaveLength(1);

  t.held.data?.('c');
  await drain();
  expect(typed).toEqual([
    ['lane-1', 'a'],
    ['lane-2', 'c'],
  ]);
});

test('a lane refused for capacity at its open says the server’s sentence and drops what waited on it; the next keystroke asks again', async () => {
  const full = { code: 'terminal-capacity', reason: 'no binding fits on the host' };
  const t = setup({ laneOpen: (opened) => (opened === 1 ? Promise.reject(full) : undefined) });
  await drain();
  t.held.data?.('a');
  await drain();
  expect(t.problems).toEqual([full.reason]);
  expect(t.inputCalls).toEqual([]);

  t.held.data?.('b');
  await drain();
  expect(t.inputCalls.map((call) => decode(call.act.bytes ?? ''))).toEqual(['b']);
});

test('a fenced input reads as the terminal ending: no lane reopens and later typing is refused', async () => {
  const t = setup({
    input: () => Promise.reject({ code: 'terminal-host-refused-InputFenced', reason: 'input was not admitted: InputFenced ended' }),
  });
  await drain();
  t.held.data?.('a');
  await drain();
  t.held.data?.('b');
  await drain();
  expect(t.doorOpens).toHaveLength(1);
  expect(t.inputCalls).toHaveLength(1);
  expect(await t.input.paste('c')).toBe(false);
  expect(t.endings).toEqual([1]);
});

test('a lane whose open answers after the view let go is closed at the door rather than left to its grace', async () => {
  const opened = Promise.withResolvers<unknown>();
  const t = setup({ laneOpen: () => opened.promise });
  await drain();
  t.input.focused();
  await drain();
  await t.input.release();
  opened.resolve({ binding: 'lane-late' });
  await drain();
  expect(t.doorCloses).toEqual([{ ...address, binding: 'lane-late' }]);
  expect(t.inputCalls).toEqual([]);
});

test('what the engine reports while the view is not focused opens no lane', async () => {
  const t = setup({}, { focused: () => false });
  await drain();
  t.held.data?.(`${ESC}[<35;10;5M`);
  await drain();
  expect(t.doorOpens).toEqual([]);
  expect(t.inputCalls).toEqual([]);
});

test('an answer heard on a lane that was replaced settles nothing typed on the new one', async () => {
  const hung = Promise.withResolvers<unknown>();
  const t = setup({
    input: (call) => {
      if (call.binding === 'lane-1' && call.sequence > 0) return Promise.reject(noGrant);
      if (call.binding === 'lane-2') return hung.promise;
      return admitted(call.sequence);
    },
  });
  await drain();
  t.held.data?.('a');
  await drain();
  const pasted = t.input.paste('b');
  await drain();
  await drain();
  expect(t.inputCalls.at(-1)?.binding).toBe('lane-2');
  expect(t.inputCalls.at(-1)?.sequence).toBe(0);

  const settledEarly = await Promise.race([
    pasted,
    (async () => {
      t.receiptListeners[0]?.({ kind: 'applied', sequence: 0, outcome: admitted(0) } as unknown as TerminalInputReceipt);
      await drain();
      return 'unsettled' as const;
    })(),
  ]);
  expect(settledEarly).toBe('unsettled');
  hung.resolve(admitted(0));
  expect(await pasted).toBe(true);
});

test('a hover over an unfocused view types nothing into its lane, while a wheel over it still does', async () => {
  let focused = true;
  const t = setup({}, { focused: () => focused });
  await drain();
  t.held.data?.('a');
  await drain();
  focused = false;
  t.held.data?.(`${ESC}[<35;10;5M`);
  t.held.data?.(`${ESC}[<65;10;5M`);
  await drain();
  expect(t.inputCalls.map((call) => decode(call.act.bytes ?? ''))).toEqual(['a', `${ESC}[<65;10;5M`]);
});

test('a wheel over an unfocused view that holds no lane yet opens one and reaches the program', async () => {
  const t = setup({}, { focused: () => false });
  await drain();
  t.held.data?.(`${ESC}[<65;10;5M`);
  await drain();
  expect(t.doorOpens).toHaveLength(1);
  expect(t.inputCalls.map((call) => decode(call.act.bytes ?? ''))).toEqual([`${ESC}[<65;10;5M`]);
});

test('focus reports and a hover go as raw, a click or wheel as mouse, and what the person typed as typed', async () => {
  const t = setup();
  await drain();
  t.held.data?.(`${ESC}[I`);
  await drain();
  t.held.data?.('ls');
  await drain();
  t.held.binary?.(`${ESC}[M${String.fromCharCode(96)}!!`);
  await drain();
  t.held.data?.(`${ESC}[<35;10;5M`);
  await drain();
  t.held.data?.(`${ESC}[I${ESC}[<0;10;5M`);
  await drain();
  expect(t.inputCalls.map((call) => call.cause)).toEqual(['raw', 'typed', 'mouse', 'raw', 'mouse']);
});
