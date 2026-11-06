// @vitest-environment jsdom
import { ByteOffset } from '@runlith/executions/protocol/record';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { Host } from '@runlith/layer/Host';
import { Scope } from '@runlith/layer/Scope';
import { EXECUTION_SETTING_KEYS as SETTING_KEYS } from '@tagma/server/executions/settings';
import { resolve } from '@tagma/server/appearance/contract/wire/resolve';
import type { SettingEntry } from '@tagma/server/settings/contract/wire/catalog';
import type {
  TerminalDecider,
  TerminalGridReport,
  TerminalGridSubscription,
  TerminalScreenPoint,
} from '@tagma/server/executions/contract/wire/viewLeases';
import type { RecordDelivery } from '@tagma/server/executions/contract/wire/viewLeases';
import { waitFor } from '@runlith/testing/flush';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { LiveFailure } from '$lib/wire/Live.js';
import { Refusal } from '$lib/wire/refusal.js';
import { STREAM_MISSING } from './RecordStream.svelte.js';
import { TerminalAppearance } from '../appearance/Settings.svelte.js';
import { terminalKeymap } from './testing/keys.svelte.js';
import { TerminalOutput, pageHidden, pageTime, type Time } from './Output.js';
import { TerminalPane, type PaneGround, type PaneLifecycleClock, type PaneSource } from './Pane.svelte.js';
import type { DroppedPaths } from './fileDrop.js';
import { TerminalRenderPolicy } from './RenderPolicy.js';
import { TerminalHolders } from './Holders.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { DROP, LaneEndpoint, admitted, backpressure, conflict, type LaneAct } from './testing/endpoint.js';

const ADDRESS = { execution: 'x-1', incarnation: 0 };
const FRESH = { execution: 'x-2', incarnation: 0 };
const start = ByteOffset.make('0');

type Sent = {
  readonly execution: string;
  readonly incarnation: number;
  readonly binding: string;
  readonly sequence: number;
  readonly cause: string;
  readonly act: { readonly _tag: 'Write'; readonly bytes: string } | { readonly _tag: 'Interrupt' };
};

type DoorOpts = {
  bytesBody?: string;
  screen?: TerminalScreenPoint;
  streams?: Readonly<Record<string, string | Error>>;
  bytesGrid?: { readonly rows: number; readonly columns: number };
  through?: string;
  recordFor?: (address: { execution: string }) => unknown;
  startWith?: (operationId: string) => Promise<unknown>;
  operationFor?: (operationId: string) => unknown;
  inputWith?: (act: Sent) => Promise<unknown>;
  takeOverWith?: (operationId: string) => Promise<unknown>;
};

function doorOver(replay: string, opts: DoorOpts = {}) {
  const sent: Sent[] = [];
  const startCalls: unknown[] = [];
  const stopCalls: unknown[] = [];
  const bytesCalls: string[] = [];
  const bytesStreams: string[] = [];
  const recordCalls: unknown[] = [];
  const operationReads: string[] = [];
  const pressure = { armed: false };
  const lanes = new Map<string, { readonly execution: string; readonly incarnation: number }>();
  const atGate = (call: LaneAct): Promise<unknown> => {
    const at = lanes.get(call.binding) ?? { execution: '', incarnation: -1 };
    const act: Sent = {
      ...at,
      binding: call.binding,
      sequence: call.sequence,
      cause: call.cause,
      act: call.act._tag === 'Write' ? { _tag: 'Write', bytes: call.act.bytes ?? '' } : { _tag: 'Interrupt' },
    };
    sent.push(act);
    if (opts.inputWith !== undefined) return opts.inputWith(act);
    if (pressure.armed) {
      pressure.armed = false;
      return Promise.resolve(backpressure(16000));
    }
    return Promise.resolve(admitted(act.sequence));
  };
  const endpoint = new LaneEndpoint(atGate);
  const body = opts.bytesBody ?? replay;
  const bytes = new TextEncoder().encode(body);
  const through = ByteOffset.make(opts.through ?? String(bytes.length));
  const laneOpens: { execution: string; incarnation: number; view: string }[] = [];
  const laneCloses: { execution: string; incarnation: number; binding: string }[] = [];
  const takeOverCalls: { execution: string; operationId: string }[] = [];
  const repo = {
    takeOver: {
      run: (payload: { execution: string; operationId: string }) => {
        takeOverCalls.push(payload);
        return opts.takeOverWith?.(payload.operationId) ?? Promise.resolve({ _tag: 'Moved', revision: 9 });
      },
    },
    laneOpen: {
      run: (payload: { execution: string; incarnation: number; view: string }) => {
        laneOpens.push(payload);
        const binding = `lane-${laneOpens.length}`;
        lanes.set(binding, { execution: payload.execution, incarnation: payload.incarnation });
        endpoint.stand(`secret-${binding}`, binding);
        return Promise.resolve({ binding, url: 'ws://127.0.0.1:9/terminal', token: `secret-${binding}`, next: 0 });
      },
    },
    laneClose: {
      run: (payload: { execution: string; incarnation: number; binding: string }) => {
        laneCloses.push(payload);
        return Promise.resolve({ closed: true });
      },
    },
    bytes: byteWindow('terminal'),
    commandBytes: byteWindow('command'),
    record: {
      key: (at: { execution: string }) => ({
        refresh: () => {
          recordCalls.push(at);
          return Promise.resolve(opts.recordFor?.(at));
        },
      }),
    },
    start: {
      run: (input: { operationId: string }) => {
        startCalls.push(input);
        if (opts.startWith !== undefined) return opts.startWith(input.operationId);
        return Promise.resolve({ operation: { _tag: 'Digest', digest: { execution: FRESH } } });
      },
    },
    operation: {
      key: (operationId: string) => ({
        refresh: () => {
          operationReads.push(operationId);
          return Promise.resolve(opts.operationFor?.(operationId) ?? { _tag: 'Digest', digest: { phase: 'unknown' } });
        },
      }),
    },
    stop: {
      run: (input: unknown) => {
        stopCalls.push(input);
        return Promise.resolve(undefined);
      },
    },
  };
  function byteWindow(record: 'terminal' | 'command') {
    return {
      key: (key: { execution: string; offset: string; stream: string }) => ({
        refresh: () => {
          bytesCalls.push(key.offset);
          bytesStreams.push(record === 'terminal' ? key.stream : `command:${key.stream}`);
          const own = opts.streams?.[key.stream];
          if (own instanceof Error) return Promise.reject(own);
          const text = own ?? body;
          const fresh = key.execution === FRESH.execution;
          const frontier = fresh ? start : own === undefined ? through : ByteOffset.make(String(new TextEncoder().encode(own).length));
          if (BigInt(key.offset) > BigInt(frontier)) {
            return Promise.reject(new Error(`offset ${key.offset} stands past the ${frontier} bytes confirmed`));
          }
          return Promise.resolve({
            range: {
              next: frontier,
              durableThrough: frontier,
              retainedFrom: start,
              gap: false,
              cursor: { offset: start },
              grid: opts.bytesGrid === undefined || fresh ? undefined : opts.bytesGrid,
            },
            bytes: fresh ? btoa('') : btoa(text),
          });
        },
      }),
    };
  }
  return {
    repo,
    sent,
    atGate,
    startCalls,
    stopCalls,
    bytesCalls,
    bytesStreams,
    recordCalls,
    operationReads,
    laneOpens,
    laneCloses,
    takeOverCalls,
    pressure,
    endpoint,
  };
}

function feedOver(endpoint: LaneEndpoint, screen?: TerminalScreenPoint) {
  const delivered: RecordDelivery[] = [];
  let deliver: ((delivery: RecordDelivery) => unknown) | null = null;
  let fail: ((failure: LiveFailure) => void) | null = null;
  let applied: ((frame: TerminalDecider) => void) | null = null;
  const gridSubscriptions: TerminalGridSubscription[] = [];
  const gridReports: TerminalGridReport[] = [];
  const client = {
    'terminal.bytes.subscribe': (payload: unknown) => ({ road: 'bytes' as const, payload }),
    'terminal.bytes.parsed': (payload: unknown) => Promise.resolve(payload),
    'command.bytes.subscribe': (payload: unknown) => ({ road: 'bytes' as const, payload }),
    'command.bytes.parsed': (payload: unknown) => Promise.resolve(payload),
    'terminal.screen.point': () =>
      Promise.resolve(screen ?? { _tag: 'ScreenUnavailable', reason: 'transport', detail: 'this suite opens on the record' }),
    'terminal.lane.hold': (payload: unknown) => ({ road: 'lease' as const, payload }),
    'terminal.grid.subscribe': (payload: TerminalGridSubscription) => {
      gridSubscriptions.push(payload);
      return { road: 'grid' as const, payload };
    },
    'terminal.grid.report': (payload: TerminalGridReport) => {
      gridReports.push(payload);
      return Promise.resolve({ acknowledged: true as const });
    },
  };
  const feed = {
    hold: (open: (client: unknown) => unknown, onItem: (item: never) => unknown, onFailure?: (failure: LiveFailure) => void) => {
      const opened = open(client) as { readonly road: 'bytes' | 'lease' | 'grid' };
      if (opened.road === 'grid') {
        const listener = onItem as (frame: TerminalDecider) => void;
        applied = listener;
        return {
          unsubscribe: () => {
            if (applied === listener) applied = null;
          },
        };
      }
      if (opened.road === 'lease') return { unsubscribe: () => undefined };
      const listener = onItem as (delivery: RecordDelivery) => unknown;
      deliver = listener;
      fail = onFailure ?? null;
      return {
        unsubscribe: () => {
          if (deliver !== listener) return;
          deliver = null;
          fail = null;
        },
      };
    },
    call: (work: (client: unknown) => unknown) => Promise.resolve(work(client)),
    subscribeStatus: (listener: (status: string) => void) => {
      listener('open');
      return () => undefined;
    },
    status: 'open',
  };
  return {
    feed,
    delivered,
    gridSubscriptions,
    gridReports,
    apply: (frame: TerminalDecider) => applied?.(frame),
    isHeld: () => deliver !== null || endpoint.following() !== undefined,
    laned: () => endpoint.following() !== undefined,
    emit: (offset: number, text: string) => endpoint.following()?.write(offset, text),
    send: (delivery: RecordDelivery) => {
      delivered.push(delivery);
      deliver?.(delivery);
    },
    refuse: (failure: LiveFailure) => {
      fail?.(failure);
    },
  };
}

type SettingsStub = {
  catalog: { key: (projectId: number | undefined) => { readonly data: unknown } };
  write: { data: unknown };
};

const settings: SettingsStub = {
  catalog: { key: () => ({ data: terminalCatalog() }) },
  write: { data: undefined },
};

function terminalCatalog(over: Record<string, unknown> = {}): { entries: SettingEntry[]; sections: never[]; rejections: never[] } {
  return {
    entries: SETTING_KEYS.filter((key) => key.section === 'terminal').map((key) => ({
      id: key.id,
      section: key.section,
      title: key.title,
      description: key.description,
      shape: '',
      scopes: key.scopes,
      merge: key.merge,
      value: over[key.id] ?? key.fallback,
      from: 'default',
      fallback: key.fallback,
      layers: {},
    })),
    sections: [],
    rejections: [],
  };
}

let scope: Scope;
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  scope = Scope.make('pane-test');
});

afterEach(async () => {
  stop?.();
  stop = null;
  await scope.close();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function paneOver(
  replay: string,
  opts: DoorOpts & {
    lifecycle?: PaneLifecycleClock;
    time?: Time;
    ceiling?: { cols: number; rows: number };
    settings?: SettingsStub;
    known?: boolean;
    attached?: boolean;
    holders?: TerminalHolders;
    source?: PaneSource;
    serving?: boolean;
  } = {},
) {
  const {
    repo,
    sent,
    startCalls,
    stopCalls,
    bytesCalls,
    bytesStreams,
    recordCalls,
    operationReads,
    laneOpens,
    laneCloses,
    takeOverCalls,
    pressure,
    endpoint,
  } = doorOver(replay, opts);
  endpoint.serving = opts.serving ?? true;
  const { feed, delivered, gridSubscriptions, gridReports, apply, isHeld, laned, emit, send, refuse } = feedOver(endpoint, opts.screen);
  const platform = new Host('tab', 'linux');
  const acted: string[] = [];
  const ground = {
    root: '/tmp',
    projectId: 1,
    visible: () => true,
    focused: (paneId: string) => paneId === 'pane-1',
    noteBell: () => undefined,
    close: () => undefined,
    ceiling: () => opts.ceiling ?? null,
    perform: (act: { _tag: string }) => {
      acted.push(act._tag);
      return true;
    },
  };
  let pane!: TerminalPane;
  let policy!: TerminalRenderPolicy;
  let appearance!: TerminalAppearance;
  const settingsStub = opts.settings ?? settings;
  stop = $effect.root(() => {
    appearance = new TerminalAppearance(settingsStub as never, { contextProject: { id: ground.projectId } } as never, {
      look: { id: 'tagma', mode: 'dark', terminal: resolve(undefined, 'dark').terminal },
    });
    policy = new TerminalRenderPolicy(
      platform,
      () => ({ webgl2: false, renderer: null, vendor: null, displayServer: null }),
      { requestFrame: () => 0, cancelFrame: () => undefined, delay: () => 0, now: () => 0 },
      () => 'off',
    );
    pane = new TerminalPane(
      'pane-1',
      ground as unknown as PaneGround,
      '/bin/zsh',
      repo as never,
      feed as never,
      endpoint.channel,
      { road: () => () => Promise.resolve(null) } as never,
      opts.holders ?? new TerminalHolders(() => [], ThreadNames.make()),
      new TerminalOutput(opts.time ?? pageTime(), pageHidden, scope),
      policy,
      terminalKeymap(platform),
      appearance,
      new Notices(scope),
      platform,
      { open: () => Promise.resolve() } as never,
      scope,
      opts.lifecycle,
    );
  });
  if (opts.known ?? true) await tick();
  const box = document.createElement('div');
  document.body.appendChild(box);
  if (opts.attached ?? true) pane.attach(box);
  pane.bind(ADDRESS, { source: opts.source });
  if ((opts.attached ?? true) && appearance.known) await until(() => pane.measuredGrid() !== null, 'the attached engine');
  return {
    pane,
    sent,
    acted,
    box,
    policy,
    startCalls,
    stopCalls,
    bytesCalls,
    bytesStreams,
    recordCalls,
    operationReads,
    laneOpens,
    laneCloses,
    takeOverCalls,
    pressure,
    delivered,
    gridSubscriptions,
    gridReports,
    apply,
    isHeld,
    laned,
    emit,
    send,
    refuse,
  };
}

async function until(reached: () => boolean, what: string): Promise<void> {
  await waitFor(() => expect(reached(), what).toBe(true));
}

function engineBackground(box: HTMLElement): string {
  return box.querySelector<HTMLElement>('.xterm')?.style.backgroundColor ?? '';
}

test('a pane drawn before the appearance is known opens no engine, and opens on the first known reading', async () => {
  let answered: (catalog: unknown) => void = () => {
    throw new Error('the settings were never asked');
  };
  const readings = new SvelteMap<number | undefined, unknown>();
  const waiting: SettingsStub = {
    catalog: {
      key: (projectId) => ({
        get data() {
          answered = (catalog) => readings.set(projectId, catalog);
          return readings.get(projectId);
        },
      }),
    },
    write: { data: undefined },
  };
  const env = await paneOver('', { known: false, settings: waiting });
  const { pane, box, isHeld } = env;
  await tick();

  expect(pane.measuredGrid()).toBe(null);
  expect(box.querySelector('.xterm')).toBe(null);
  expect(isHeld()).toBe(false);

  answered(terminalCatalog({ 'terminal.colorOverrides': { background: '#102030' } }));
  await until(() => pane.measuredGrid() !== null, 'the engine the known reading opens');
  await until(() => isHeld(), 'the feed the bind opened');
  expect(box.querySelector('.xterm')).not.toBe(null);
  expect(engineBackground(box)).toBe('rgb(16, 32, 48)');
});

test('a pane moves between hosts without losing its buffer and returns to the previous mounted host', async () => {
  const copied: string[] = [];
  const clipboard = { writeText: (text: string) => (copied.push(text), Promise.resolve()) };
  vi.stubGlobal(
    'navigator',
    new Proxy(navigator, { get: (held, key) => (key === 'clipboard' ? clipboard : Reflect.get(held, key, held)) }),
  );
  const { pane, box } = await paneOver('hello from the shell');
  await until(() => {
    pane.selectAll();
    void pane.copy();
    return copied.join('').includes('hello from the shell');
  }, 'the replayed bytes in the engine');

  const chrome = box.querySelector('.pane-chrome');
  expect(chrome).not.toBe(null);
  const second = document.createElement('div');
  document.body.appendChild(second);
  pane.detach(box);
  pane.attach(second);

  expect(second.querySelector('.pane-chrome')).toBe(chrome);
  expect(box.querySelector('.pane-chrome')).toBe(null);

  copied.length = 0;
  pane.selectAll();
  await pane.copy();
  expect(copied.join('')).toContain('hello from the shell');

  pane.attach(box);
  pane.attach(second);
  pane.detach(second);
  expect(box.querySelector('.pane-chrome')).toBe(chrome);
  pane.attach(second);
  pane.detach(box);
  expect(second.querySelector('.pane-chrome')).toBe(chrome);
  expect(pane.shown).toBe(true);
});

test('a place out of view opens no engine, and visibility changes preserve the standing engine', async () => {
  let notice: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | undefined;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(changed: typeof notice) {
        notice = changed;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const env = await paneOver('visible', { attached: false });
  const stopWatching = env.pane.watchPlace(env.box);
  env.pane.attach(env.box);
  await tick();
  expect(env.pane.parked).toBe(true);
  notice?.([{ target: env.box, isIntersecting: true }]);
  await until(() => env.isHeld(), 'the byte stream of the visible place');
  const engine = env.box.querySelector('.xterm');
  expect(engine?.isConnected).toBe(true);
  notice?.([{ target: env.box, isIntersecting: false }]);
  expect(env.pane.parked).toBe(false);
  notice?.([{ target: env.box, isIntersecting: true }]);
  expect(env.box.querySelector('.xterm')).toBe(engine);
  stopWatching();
});

test('increasing the scrollback of a hidden pane releases an engine that no longer fits its budget', async () => {
  const env = await paneOver('held');
  await until(() => env.isHeld(), 'the byte stream');
  env.pane.visibility(env.box, false);
  expect(env.pane.parked).toBe(false);
  env.pane.applyOptions({ scrollback: 50000 });
  expect(env.pane.parked).toBe(true);
  expect(env.isHeld()).toBe(false);
});

test('a hidden pane past its budget releases its engine and stream, then restores the screen and bracketed input on return', async () => {
  const copied: string[] = [];
  vi.stubGlobal(
    'navigator',
    new Proxy(navigator, {
      get: (held, key) =>
        key === 'clipboard' ? { writeText: (text: string) => (copied.push(text), Promise.resolve()) } : Reflect.get(held, key, held),
    }),
  );
  const env = await paneOver('tail', {
    settings: { catalog: { key: () => ({ data: terminalCatalog({ 'terminal.scrollbackRows': 50000 }) }) }, write: { data: undefined } },
    screen: {
      _tag: 'ScreenPoint',
      ref: { installation: InstallationId.make('pane'), execution: ExecutionId.make(ADDRESS.execution), incarnation: ADDRESS.incarnation },
      position: start,
      geometry: { rows: 24, columns: 80 },
      bytes: new TextEncoder().encode('\u001b[?1049h\u001b[?2004hprior '),
    },
  });
  const painted = async (): Promise<boolean> => {
    env.pane.selectAll();
    await env.pane.copy();
    return copied.at(-1)?.includes('prior tail') === true;
  };
  await until(() => env.isHeld(), 'the initial screen and byte stream');
  expect(await painted()).toBe(true);
  env.pane.visibility(env.box, false);
  expect(env.pane.parked).toBe(true);
  expect(env.isHeld()).toBe(false);
  expect(env.box.querySelector('.xterm')).toBeNull();
  env.pane.visibility(env.box, true);
  await until(() => env.isHeld(), 'the restored byte stream');
  expect(env.pane.parked).toBe(false);
  expect(await painted()).toBe(true);
  env.pane.focus();
  await env.pane.paste('typed');
  await until(() => env.sent.some((act) => act.act._tag === 'Write'), 'the paste on the restored input lane');
  const pasted = env.sent.find((act) => act.act._tag === 'Write');
  expect(pasted?.act._tag === 'Write' ? atob(pasted.act.bytes) : null).toBe('\u001b[200~typed\u001b[201~');
});

function type(box: HTMLElement, key: string, keyCode: number): void {
  const keyboard = box.querySelector('textarea');
  keyboard?.focus();
  keyboard?.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
}

function bytesChunk(text: string, next: string, grid?: { readonly rows: number; readonly columns: number }): RecordDelivery {
  return {
    viewer: 'test-viewer',
    chunk: {
      _tag: 'Bytes',
      bytes: new TextEncoder().encode(text),
      range: {
        cursor: {
          ref: { installation: 'test', execution: 'x-1', incarnation: 0 },
          stream: 'pty',
          offset: start,
        },
        next: ByteOffset.make(next),
        retainedFrom: start,
        durableThrough: ByteOffset.make(next),
        gap: false,
        grid,
      },
    },
  } as unknown as RecordDelivery;
}

function endedChunk(): RecordDelivery {
  return { viewer: 'test-viewer', chunk: { _tag: 'Ended', ending: 'completed' } } as unknown as RecordDelivery;
}

async function focusFresh(pane: TerminalPane, box: HTMLElement): Promise<void> {
  await until(() => pane.address?.execution === FRESH.execution, 'the fresh execution');
  box.querySelector('textarea')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

test('a refused feed of a shell that ended shows its exit, with nothing over the terminal', async () => {
  const env = await paneOver('', {
    serving: false,
    recordFor: () => ({ record: { revision: 3 }, state: { phase: 'ended', nativeExit: { _tag: 'Code', code: 1 } } }),
  });
  await until(() => env.isHeld(), 'the live feed');
  env.refuse({
    kind: 'subscription',
    message: 'this host holds no execution under that reference',
    code: 'terminal-host-refused-UnknownExecution',
    unblock: ['read the terminal list again'],
  });
  await until(() => env.pane.ending !== null, 'the exit on the pane');
  expect(env.pane.ending).toEqual({ _tag: 'Exit', native: { _tag: 'Code', code: 1 } });
  expect(env.pane.refusal).toBeNull();
  expect(env.pane.recovering).toBe(false);
});

test('an Ended frame closes input, and Restart keeps the old record while opening a fresh pty and input lane in the same cwd', async () => {
  const env = await paneOver('hello from the old shell', {
    serving: false,
    ceiling: { cols: 200, rows: 60 },
    recordFor: (at) =>
      at.execution === 'x-1' ? { record: { revision: 3 }, state: { nativeExit: { _tag: 'Code', code: 3 } } } : { record: { revision: 9 } },
  });
  const { pane } = env;
  pane.cwd = '/tmp/proj';

  await until(() => env.isHeld(), 'the live feed');
  expect(env.box.querySelector('textarea')?.readOnly).toBe(false);
  type(env.box, 'a', 65);
  await until(() => env.laneOpens.length === 1, 'the lane of the old shell');
  env.send(endedChunk());
  await until(() => pane.ending !== null, 'the exit on the pane');
  expect(pane.ending).toEqual({ _tag: 'Exit', native: { _tag: 'Code', code: 3 } });
  expect(env.box.querySelector('textarea')?.readOnly).toBe(true);

  await pane.restart();
  await until(() => pane.address?.execution === 'x-2', 'the fresh execution');
  expect(env.startCalls[0]).toMatchObject({
    cwd: '/tmp/proj',
    transport: 'pty',
    lifetime: 'held',
    geometry: { rows: 24, columns: 80 },
  });
  expect(pane.ending).toBeNull();
  expect(env.box.querySelector('textarea')?.readOnly).toBe(false);
  expect(env.stopCalls).toEqual([]);

  expect(env.bytesCalls.at(-1)).toBe('0');
  expect(pane.refusal).toBeNull();
  type(env.box, 'l', 76);
  await until(() => env.laneOpens.length === 2, 'the lane of the fresh shell');
  expect(env.laneOpens[1]).toEqual({ ...FRESH, view: pane.view });
});

test('a flowing feed costs the watchdog no IPC', async () => {
  const runs: Array<() => Promise<void>> = [];
  const env = await paneOver('', {
    lifecycle: {
      now: () => 0,
      every: (_ms: number, run: () => Promise<void>) => {
        runs.push(run);
        return () => undefined;
      },
    },
  });
  await until(() => env.laned(), 'the live output on the lane');
  env.emit(0, 'hi');
  const tick = runs[0];
  if (!tick) throw new Error('the watchdog never started');
  await tick();
  expect(env.recordCalls).toHaveLength(0);
  expect(env.bytesCalls).toHaveLength(1);
});

test('two silent ticks heal once, and ticks inside the minute do not heal again', async () => {
  const runs: Array<() => Promise<void>> = [];
  const tickMs: number[] = [];
  let now = 1_000_000;
  const env = await paneOver('', {
    lifecycle: {
      now: () => now,
      every: (ms: number, run: () => Promise<void>) => {
        tickMs.push(ms);
        runs.push(run);
        return () => undefined;
      },
    },
    recordFor: () => ({ record: { revision: 3 }, state: { phase: 'running' } }),
    bytesBody: '',
    through: '5',
  });
  await until(() => env.bytesCalls.length === 1, 'the first read');
  expect(tickMs).toEqual([15000]);
  const tick = runs[0];
  if (!tick) throw new Error('the watchdog never started');

  await tick();
  expect(env.bytesCalls).toHaveLength(2);
  await tick();
  expect(env.bytesCalls).toHaveLength(4);
  await tick();
  expect(env.bytesCalls).toHaveLength(5);
  await tick();
  expect(env.bytesCalls).toHaveLength(6);
  now += 60_000;
  await tick();
  expect(env.bytesCalls).toHaveLength(8);
});

test('a tail inside 100 ms of replacement is dropped and typing 200 ms later is not', async () => {
  let now = 2_000_000;
  const env = await paneOver('', {
    lifecycle: {
      now: () => now,
      every: () => () => undefined,
    },
    recordFor: (at) => (at.execution === 'x-2' ? { record: { revision: 9 } } : undefined),
  });
  const { pane, box, sent } = env;
  pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 0 } };

  type(box, 'a', 65);
  await until(() => sent.some((act) => act.act._tag === 'Write' && act.execution === 'x-1'), 'control under the old execution');

  env.pressure.armed = true;
  type(box, 'x', 88);
  void pane.restart();
  await focusFresh(pane, box);
  await until(() => sent.some((act) => act.act._tag === 'Write' && act.execution === 'x-2'), 'the stale tail at the fresh gate');
  const stale = sent.filter((act) => act.act._tag === 'Write' && act.execution === 'x-2');
  expect(stale).toHaveLength(1);
  expect(stale[0]?.act).toEqual({ _tag: 'Write', bytes: '' });

  now += 200;
  type(box, 'y', 89);
  await until(
    () => sent.filter((act) => act.act._tag === 'Write' && act.execution === 'x-2').length === 2,
    'the fresh typing at the fresh gate',
  );
  const fresh = sent.filter((act) => act.act._tag === 'Write' && act.execution === 'x-2');
  expect(fresh[1]?.act).toEqual({ _tag: 'Write', bytes: btoa('y') });
});

test('a Restart whose reply was lost is read back by its own key, never spent on a second shell', async () => {
  let sends = 0;
  let stood: unknown = { _tag: 'Digest', digest: { phase: 'uncertain' } };
  const env = await paneOver('', {
    attached: false,
    recordFor: (at) => (at.execution === 'x-2' ? { record: { revision: 9 } } : undefined),
    startWith: () => {
      sends += 1;
      return Promise.reject(new Error('socket closed'));
    },
    operationFor: () => stood,
  });
  const { pane } = env;
  pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 0 } };

  await pane.restart();
  expect(sends).toBe(1);
  expect(env.operationReads.length).toBe(1);
  expect(pane.ending).not.toBeNull();
  expect(pane.refusal?.message).toContain('unanswered');

  stood = { _tag: 'Whole', state: { _tag: 'Settled', execution: FRESH } };
  await pane.restart();
  await until(() => pane.address?.execution === 'x-2', 'the shell the lost act opened');
  expect(sends).toBe(1);
  expect(env.operationReads.length).toBe(2);
  expect(env.operationReads[0]).toBe(env.operationReads[1]);
  expect(pane.ending).toBeNull();
});

test('Restart before the engine opens starts the fresh shell and lets the first keystroke after the wait through', async () => {
  let now = 4_000_000;
  const catalog = $state<{ data: unknown }>({ data: undefined });
  const env = await paneOver('', {
    lifecycle: { now: () => now, every: () => () => undefined },
    settings: { catalog: { key: () => catalog }, write: { data: undefined } },
    recordFor: (at) => (at.execution === 'x-2' ? { record: { revision: 9 } } : undefined),
  });
  const { pane, box, sent } = env;
  expect(pane.parked).toBe(true);
  pane.end({ _tag: 'Exit', native: { _tag: 'Code', code: 0 } });
  await pane.restart();
  expect(pane.address).toEqual(FRESH);
  expect(pane.ending).toBeNull();

  catalog.data = terminalCatalog();
  await until(() => env.isHeld(), 'the fresh shell on the engine');
  sent.length = 0;
  now += 200;
  type(box, 'y', 89);
  await until(() => sent.some((act) => act.act._tag === 'Write' && act.act.bytes === btoa('y')), 'the first keystroke after the wait');
});

test('the interrupt typed to abandon a mangled line is not quarantined with the tail', async () => {
  let now = 3_000_000;
  const env = await paneOver('', {
    lifecycle: { now: () => now, every: () => () => undefined },
    recordFor: (at) => (at.execution === 'x-2' ? { record: { revision: 9 } } : undefined),
  });
  const { pane, box, sent } = env;
  pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 0 } };
  type(box, 'a', 65);
  await until(() => sent.some((act) => act.act._tag === 'Write' && act.execution === 'x-1'), 'control');

  env.pressure.armed = true;
  type(box, 'x', 88);
  void pane.restart();
  await focusFresh(pane, box);
  await until(() => sent.some((act) => act.execution === 'x-2'), 'the stale tail at the fresh gate');

  box
    .querySelector('textarea')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', keyCode: 67, ctrlKey: true, bubbles: true, cancelable: true }));
  await until(() => sent.some((act) => act.act._tag === 'Interrupt'), 'the interrupt at the fresh gate');

  type(box, 'y', 89);
  await until(
    () => sent.some((act) => act.act._tag === 'Write' && act.execution === 'x-2' && act.act.bytes === btoa('y')),
    'typing after the interrupt disarmed the quarantine',
  );
});

test('a quarantined act resent after a lost answer keeps the verdict it was first given', async () => {
  const now = 6_000_000;
  const receipts = new Map<string, Sent>();
  let lost = false;
  const env = await paneOver('', {
    lifecycle: { now: () => now, every: () => () => undefined },
    recordFor: (at) => (at.execution === 'x-2' ? { record: { revision: 9 } } : undefined),
    inputWith: (act) => {
      if (act.execution === 'x-1') return Promise.resolve(backpressure(16000));
      const key = `${act.binding}:${act.sequence}`;
      const prior = receipts.get(key);
      if (prior !== undefined) {
        return Promise.resolve(
          prior.act._tag === 'Write' && act.act._tag === 'Write' && prior.act.bytes === act.act.bytes
            ? admitted(act.sequence)
            : conflict(act.sequence),
        );
      }
      receipts.set(key, act);
      if (!lost) {
        lost = true;
        return Promise.resolve(DROP);
      }
      return Promise.resolve(admitted(act.sequence));
    },
  });
  const { pane, box, sent } = env;
  pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 0 } };
  type(box, 'x', 88);
  type(box, 'Enter', 13);
  void pane.restart();
  await focusFresh(pane, box);
  await until(() => sent.filter((act) => act.execution === 'x-2' && act.sequence === 0).length >= 2, 'the resent act');

  for (const act of sent.filter((act) => act.execution === 'x-2' && act.sequence === 0)) {
    expect(act.act._tag === 'Write' && act.act.bytes === btoa('')).toBe(true);
  }
  type(box, 'y', 89);
  await until(
    () => sent.some((act) => act.execution === 'x-2' && act.act._tag === 'Write' && act.act.bytes === btoa('y')),
    'typing after the resent act settled',
  );
});

test('the bound pane opens its input lane as it binds, and types keystrokes and shell-quoted dropped paths into it', async () => {
  const env = await paneOver('');
  await until(() => env.laneOpens.length === 1, 'the lane the bind opened');
  expect(env.laneOpens[0]).toEqual({ ...ADDRESS, view: env.pane.view });

  env.box.querySelector('textarea')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

  type(env.box, 'l', 76);
  await until(() => env.sent.some((act) => act.act._tag === 'Write'), 'the keystroke at the input gate');
  const write = env.sent.find((act) => act.act._tag === 'Write');
  expect([write?.binding, write?.act]).toEqual(['lane-1', { _tag: 'Write', bytes: btoa('l') }]);

  env.sent.length = 0;
  env.pane.pastePaths(["/tmp/a b/it's $(id);.txt"]);
  await until(() => env.sent.some((act) => act.act._tag === 'Write'), 'the drop at the input gate');
  const quoted = env.sent.find((act) => act.act._tag === 'Write');
  expect(quoted?.act._tag === 'Write' ? atob(quoted.act.bytes) : '').toBe(`'/tmp/a b/it'\\''s $(id);.txt' `);
  env.sent.length = 0;
  env.pane.pastePaths(['/tmp/notes.txt', '/tmp/my shot.png']);
  await until(() => env.sent.some((act) => act.act._tag === 'Write'), 'the second drop');
  const plain = env.sent.find((act) => act.act._tag === 'Write');
  expect(plain?.act._tag === 'Write' ? atob(plain.act.bytes) : '').toBe('/tmp/notes.txt /tmp/my\\ shot.png ');
  expect(env.laneOpens).toHaveLength(1);
});

test('a dropped path finishes once the input lane has admitted it', async () => {
  const asked = Promise.withResolvers<void>();
  const answered = Promise.withResolvers<void>();
  const order: string[] = [];
  const env = await paneOver('', {
    inputWith: async (act) => {
      asked.resolve();
      await answered.promise;
      order.push('admitted');
      return admitted(act.sequence);
    },
  });
  await until(() => env.isHeld(), 'the live feed');
  const dropped = env.pane.pasteDropped(Promise.resolve({ paths: ['/tmp/a.txt'], problems: [] })).then(() => order.push('finished'));
  await asked.promise;
  answered.resolve();
  await dropped;
  expect(order).toEqual(['admitted', 'finished']);
  expect(env.sent.map((act) => act.act)).toEqual([{ _tag: 'Write', bytes: btoa('/tmp/a.txt ') }]);
});

test('dropped files and paths land in the order they were dropped, and none is typed into a terminal that ended while they were fetched', async () => {
  const env = await paneOver('');
  await until(() => env.isHeld(), 'the live feed');
  env.box.querySelector('textarea')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await until(() => env.laneOpens.length === 1, 'the lane the focus opened');

  let release: (answer: DroppedPaths) => void = () => undefined;
  const slow = env.pane.pasteDropped(new Promise<DroppedPaths>((done) => (release = done)));
  const fast = env.pane.pasteDropped(Promise.resolve({ paths: ['/tmp/b.txt'], problems: [] }));
  env.pane.pastePaths(['/tmp/c.txt']);
  release({ paths: ['/tmp/a.txt'], problems: [] });
  await Promise.all([slow, fast]);
  const typed = () => env.sent.flatMap((act) => (act.act._tag === 'Write' ? [atob(act.act.bytes)] : [])).join('');
  await until(() => typed().length >= '/tmp/a.txt /tmp/b.txt /tmp/c.txt '.length, 'the drops at the input gate');
  expect(typed()).toBe('/tmp/a.txt /tmp/b.txt /tmp/c.txt ');

  env.sent.length = 0;
  let late: (answer: DroppedPaths) => void = () => undefined;
  const ended = env.pane.pasteDropped(new Promise<DroppedPaths>((done) => (late = done)));
  env.pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 0 } };
  late({ paths: ['/tmp/d.txt'], problems: [] });
  await ended;
  expect(env.sent.filter((act) => act.act._tag === 'Write')).toEqual([]);
  expect(env.pane.refusal).not.toBeNull();
});

test('a picture on a clipboard with no text is pasted as the path of its kept copy where the pane takes files, into the execution it was pasted into', async () => {
  let now = 8_000_000;
  const shot = new Blob(['png'], { type: 'image/png' });
  const clipboard = {
    readText: (): Promise<string> => Promise.resolve(''),
    read: () => Promise.resolve([{ types: ['image/png'], getType: () => Promise.resolve(shot) }]),
  };
  vi.stubGlobal(
    'navigator',
    new Proxy(navigator, { get: (held, key) => (key === 'clipboard' ? clipboard : Reflect.get(held, key, held)) }),
  );
  const env = await paneOver('', { lifecycle: { now: () => now, every: () => () => undefined } });
  await until(() => env.isHeld(), 'the live feed');
  env.box.querySelector('textarea')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await until(() => env.laneOpens.length === 1, 'the lane the focus opened');

  const kept: File[] = [];
  const release = env.pane.takeFiles(async (files) => {
    kept.push(...files);
    return { paths: files.map((file) => `/srv/t1/drops/u1/${file.name}`), problems: [] };
  });
  expect(await env.pane.paste()).toBe(true);
  await until(() => env.sent.some((act) => act.act._tag === 'Write'), 'the pasted picture at the input gate');
  expect(kept.map((file) => [file.name, file.type])).toEqual([['clipboard.png', 'image/png']]);
  const typed = env.sent.find((act) => act.act._tag === 'Write');
  expect(typed?.act._tag === 'Write' ? atob(typed.act.bytes) : '').toBe('/srv/t1/drops/u1/clipboard.png ');

  let read: () => void = () => undefined;
  clipboard.readText = () => new Promise<string>((done) => (read = () => done('')));
  const pasting = env.pane.paste();
  env.pane.ending = { _tag: 'Exit', native: { _tag: 'Code', code: 0 } };
  void env.pane.restart();
  await focusFresh(env.pane, env.box);
  now += 200;
  env.sent.length = 0;
  read();
  await pasting;
  expect(env.sent.filter((act) => act.act._tag === 'Write')).toEqual([]);
  expect(env.pane.refusal).not.toBeNull();

  release();
  kept.length = 0;
  clipboard.readText = () => Promise.resolve('');
  expect(await env.pane.paste()).toBe(true);
  expect(kept).toEqual([]);
});

test('a pane watching a program on pipes reads its output stream, and neither focus nor typing opens a lane', async () => {
  const env = await paneOver('vite ready on 5194', { source: { _tag: 'Output', record: 'terminal' } });
  await until(() => env.isHeld(), 'the live feed');
  expect(env.bytesStreams.length).toBeGreaterThan(0);
  expect(new Set(env.bytesStreams)).toEqual(new Set(['output']));
  expect(env.box.querySelector('textarea')?.readOnly).toBe(true);

  env.box.querySelector('textarea')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  type(env.box, 'l', 76);
  expect(await env.pane.paste('unavailable input')).toBe(false);
  expect(env.laneOpens).toEqual([]);
  expect(env.sent).toEqual([]);
});

test('a command’s output reads the command record’s output stream and lays each line from its first column', async () => {
  const copied: string[] = [];
  const clipboard = { writeText: (text: string) => (copied.push(text), Promise.resolve()) };
  vi.stubGlobal(
    'navigator',
    new Proxy(navigator, { get: (held, key) => (key === 'clipboard' ? clipboard : Reflect.get(held, key, held)) }),
  );
  const env = await paneOver('one\ntwo\nthree\n', { source: { _tag: 'Output', record: 'command' } });
  await until(() => {
    env.pane.selectAll();
    void env.pane.copy();
    return copied.join('').includes('three');
  }, 'the replayed output in the engine');
  expect(new Set(env.bytesStreams)).toEqual(new Set(['command:output']));
  expect(
    copied
      .at(-1)
      ?.split('\n')
      .slice(0, 3)
      .map((line) => line.trimEnd()),
  ).toEqual(['one', 'two', 'three']);
});

test('a command recorded before the output stream shows its stdout, then its stderr under a line saying their order was not kept', async () => {
  const copied: string[] = [];
  const clipboard = { writeText: (text: string) => (copied.push(text), Promise.resolve()) };
  vi.stubGlobal(
    'navigator',
    new Proxy(navigator, { get: (held, key) => (key === 'clipboard' ? clipboard : Reflect.get(held, key, held)) }),
  );
  const missing = new Refusal({ gate: true, code: STREAM_MISSING, reason: 'StreamMissing', unblock: [] });
  const env = await paneOver('', {
    source: { _tag: 'Output', record: 'command' },
    streams: { output: missing, stdout: 'built\n', stderr: 'warned\n' },
  });
  await until(() => {
    env.pane.selectAll();
    void env.pane.copy();
    return copied.join('').includes('warned');
  }, 'both streams in the engine');
  const lines = copied
    .at(-1)
    ?.split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');
  expect([lines?.[0], lines?.length, lines?.at(-1)]).toEqual(['built', 3, 'warned']);
});

test('a view the server did not name, following the record, lays its bytes out at the grid their record carries, and that grid is the one kept for the next birth', async () => {
  const env = await paneOver('', { serving: false });
  await until(() => env.gridSubscriptions.length === 1, 'the view’s grid subscription');
  await until(() => env.isHeld(), 'the live feed');
  expect(env.gridSubscriptions[0]?.view).toBe(env.pane.view);
  const settledGrids: { cols: number; rows: number }[] = [];
  env.pane.onSettled((grid) => settledGrids.push(grid));
  const before = env.pane.measuredGrid();

  env.apply({ decider: 'the-other-window' as TerminalDecider['decider'], applied: { rows: 43, columns: 132 } });
  expect(env.pane.measuredGrid()).toEqual(before);
  env.send(bytesChunk('', '0', { rows: 43, columns: 132 }));
  await until(() => env.pane.measuredGrid()?.cols === 132, 'the recorded grid on this engine');
  expect(env.pane.measuredGrid()).toEqual({ cols: 132, rows: 43 });
  expect(settledGrids).toEqual([{ cols: 132, rows: 43 }]);
  expect(env.sent).toEqual([]);
});

test('a view following its lane lays its engine out at the box the grid feed applied, since the record’s grids do not reach it', async () => {
  const env = await paneOver('');
  await until(() => env.laned(), 'the live output on the lane');
  env.apply({ decider: 'the-other-window' as TerminalDecider['decider'], applied: { rows: 43, columns: 132 } });
  await until(() => env.pane.measuredGrid()?.cols === 132, 'the applied grid on this engine');
  expect(env.pane.measuredGrid()).toEqual({ cols: 132, rows: 43 });
});

test('an ended terminal read again lays its record out at the grid the record carries, and keeps no grid for the next birth', async () => {
  const env = await paneOver('the old output', { bytesGrid: { rows: 43, columns: 132 } });
  await until(() => env.isHeld(), 'the live feed');
  const settledGrids: { cols: number; rows: number }[] = [];
  env.pane.onSettled((grid) => settledGrids.push(grid));
  env.pane.end({ _tag: 'None' });
  env.pane.bind(ADDRESS, { born: { cols: 80, rows: 24 } });
  await until(() => env.pane.measuredGrid()?.cols === 132, 'the recorded grid on the ended pane');
  expect(env.pane.measuredGrid()).toEqual({ cols: 132, rows: 43 });
  expect(settledGrids).toEqual([]);
});

function namedHolders(): { holders: TerminalHolders; hold(holder: string, revision: number, heldBy?: string): void } {
  const standing = $state({ roster: [] as unknown[] });
  const names = new ThreadNames((thread) => (thread === 't-1' ? { label: 'Fix the build', archived: false, harness: true } : null));
  return {
    holders: new TerminalHolders(() => standing.roster as never, names),
    hold: (holder, revision, heldBy) => {
      standing.roster = [{ record: { execution: { ...ADDRESS }, holder, revision, heldBy } }];
    },
  };
}

test('an agent’s terminal names its holder by the thread’s name, and a transfer by another road shows with the next roster', async () => {
  const named = namedHolders();
  const env = await paneOver('', { holders: named.holders, attached: false });
  env.pane.bind(ADDRESS, { agent: 't-1' });
  expect(env.pane.holder).toEqual({ thread: 't-1', label: 'Fix the build', home: undefined });

  named.hold('operator', 4);
  expect(env.pane.holder).toBe(null);
  named.hold('thread:t-1', 5, 't-1');
  expect(env.pane.holder?.label).toBe('Fix the build');
});

test('a holder the page read from the record stands before the roster lists the terminal, and a newer roster outranks it', async () => {
  const named = namedHolders();
  const env = await paneOver('', { holders: named.holders, attached: false });
  env.pane.bind(ADDRESS);
  expect(env.pane.holder).toBe(null);
  env.pane.heldBy(ADDRESS, { holder: 't-1', revision: 3 });
  expect(env.pane.holder?.label).toBe('Fix the build');
  env.pane.heldBy(ADDRESS, { holder: null, revision: 1 });
  expect(env.pane.holder?.label).toBe('Fix the build');
  named.hold('operator', 2);
  expect(env.pane.holder?.label).toBe('Fix the build');
  named.hold('operator', 4);
  expect(env.pane.holder).toBe(null);
});

test('after Take over a roster older than the move names nobody, a newer one is believed, and typing rides the lane Take over reopened', async () => {
  const named = namedHolders();
  named.hold('thread:t-1', 3, 't-1');
  const env = await paneOver('', { holders: named.holders });
  env.pane.bind(ADDRESS, { agent: 't-1' });
  await until(() => env.isHeld(), 'the initial replay');
  env.box.querySelector('textarea')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await until(() => env.laneOpens.length === 1, 'the lane the focus opened');

  await env.pane.takeOver();
  expect(env.pane.holder).toBe(null);
  await until(() => env.laneOpens.length === 2, 'the lane Take over reopened');
  named.hold('thread:t-1', 8, 't-1');
  env.pane.heldBy(ADDRESS, { holder: 't-1', revision: 8 });
  expect(env.pane.holder).toBe(null);
  named.hold('thread:t-1', 10, 't-1');
  expect(env.pane.holder?.label).toBe('Fix the build');

  type(env.box, 'l', 76);
  await until(() => env.sent.some((act) => act.act._tag === 'Write'), 'the keystroke at the input gate');
  expect(env.sent.find((act) => act.act._tag === 'Write')?.binding).toBe('lane-2');
});

test('a Take over whose answer was lost is read back under its own key, never asked twice, and a read-back finding the operator counts as the move', async () => {
  let stood: unknown = { _tag: 'Digest', digest: { phase: 'uncertain' } };
  let holder = 'thread:t-1';
  const env = await paneOver('', {
    attached: false,
    takeOverWith: () => Promise.reject(new Error('socket closed')),
    operationFor: () => stood,
    recordFor: () => ({ record: { revision: 9, holder, heldBy: holder === 'operator' ? undefined : 't-1' } }),
  });
  env.pane.bind(ADDRESS, { agent: 't-1' });

  const taking = env.pane.takeOver();
  await until(() => env.operationReads.length > 0, 'the first read-back');
  expect(env.pane.holder).not.toBe(null);
  expect(env.pane.refusal).toBe(null);

  stood = { _tag: 'Whole', state: { _tag: 'Settled' } };
  holder = 'operator';
  await taking;
  expect(env.takeOverCalls).toHaveLength(1);
  expect(env.operationReads[0]).toBe(env.operationReads[1]);
  expect(env.pane.holder).toBe(null);
});

test('a Take over read back as settled while the record still names the agent says it did not move', async () => {
  const env = await paneOver('', {
    attached: false,
    takeOverWith: () => Promise.reject(new Error('socket closed')),
    operationFor: () => ({ _tag: 'Whole', state: { _tag: 'Settled' } }),
    recordFor: () => ({ record: { revision: 9, holder: 'thread:t-1', heldBy: 't-1' } }),
  });
  env.pane.bind(ADDRESS, { agent: 't-1' });
  await env.pane.takeOver();
  expect(env.pane.holder).not.toBe(null);
  expect(env.pane.refusal).not.toBe(null);
});

test('a Take over the server answered with a refusal is said, and the next one asks under a fresh key', async () => {
  const env = await paneOver('', {
    attached: false,
    takeOverWith: () => Promise.reject({ code: 'terminal-stale', reason: 'Custody moved while this take over ran.' }),
  });
  env.pane.bind(ADDRESS, { agent: 't-1' });
  await env.pane.takeOver();
  expect(env.pane.refusal).not.toBe(null);
  expect(env.operationReads).toEqual([]);
  await env.pane.takeOver();
  expect(env.takeOverCalls).toHaveLength(2);
  expect(env.takeOverCalls[0]).not.toEqual(env.takeOverCalls[1]);
});
