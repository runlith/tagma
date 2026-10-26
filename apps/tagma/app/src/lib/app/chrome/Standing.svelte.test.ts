// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { Refusal } from '$lib/wire/refusal.js';
import type { NextFrame } from '@tagma/server/installation/contract/wire/next';
import type { LiveConnection, LiveFailure } from '$lib/wire/Live.js';
import type { Arrival } from '$lib/wire/Restart.svelte.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { Standing } from './Standing.svelte.js';
import { WireState } from './WireState.svelte.js';

const health = (installation: string | null, standing: string | null) => ({
  ok: true as const,
  version: '0.1.0',
  database: '/d/tagma.sqlite',
  schema: { applied: 1, latest: null },
  source: { cut: null, installation: installation === null ? null : { build: installation, digest: 'sha256:aa' } },
  builds: { surface: { served: null }, host: { served: null } },
  standing: standing === null ? null : { build: standing, digest: 'sha256:bb' },
  artifactOrigin: 'http://localhost:5634',
  sandboxOrigin: null,
});

const origin = new ServerOrigin('http://localhost');

const frameOf = (revision: number, behind: number | null, more: Partial<NextFrame> = {}): NextFrame => ({
  instance: 'server-1',
  pid: 1,
  revision,
  readAt: `2026-10-12T15:50:0${revision}.000Z`,
  readFrom: null,
  watched: true,
  issue: null,
  standing: {
    tone: behind === null ? 'latest' : 'behind',
    said: [{ text: 'the source', strong: true }],
    behind: behind === null ? null : `${behind} commits`,
    behindBy: behind ?? undefined,
  },
  offers: [],
  update: null,
  back: null,
  installing: null,
  installed: null,
  acts: [],
  ...more,
});

const machineWith = (next: Partial<NextFrame> = {}) => ({
  readAt: '2026-09-18T00:00:00.000Z',
  server: {
    pid: 1,
    startedAt: '2026-09-18T00:00:00.000Z',
    born: { replacedPid: null },
    installation: null,
    cut: null,
    waiting: null,
    next: frameOf(1, null, next),
  },
  host: {
    presence: 'absent',
    detail: '',
    incarnation: null,
    build: null,
    since: null,
    custody: 'unknown',
    holds: null,
    waiting: null,
    memory: null,
  },
  acts: [],
});

const performOver = (handlers: Record<string, (payload: unknown) => Promise<unknown>>) => (id: string, payload: unknown) =>
  (handlers[id] ?? (() => Promise.reject(new Error(`no ${id}`))))(payload);

const doorOver = (answers: () => unknown, restart: (payload?: unknown) => Promise<unknown> = () => Promise.resolve()) =>
  ({
    ask: (call: (api: unknown) => unknown) =>
      call({
        health: {
          health: () => {
            const answer = answers();
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
          },
        },
      }),
    perform: performOver({
      read_machine_state: () => Promise.resolve({ machine: machineWith() }),
      restart_server: (payload) =>
        restart(payload).then(() => ({ restart: { leaving: null, successor: { _tag: 'Checkout' }, migrations: 0 } })),
    }),
  }) as never;

const scope = { defer: () => undefined } as never;

const RETURNED: Arrival = { _tag: 'Returned' };

const windowOf = (arrival: Promise<Arrival> = Promise.resolve(RETURNED)) => {
  const opened: Array<{ acted: boolean; leaving: number | null }> = [];
  return {
    opened,
    open: (acted: boolean, leaving: number | null) => {
      opened.push({ acted, leaving });
      return arrival;
    },
    reloadIfBehind: () => Promise.resolve(),
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('an installed server behind what stands names the update; one running what stands, and a checkout, name none', async () => {
  const behind = new Standing(
    doorOver(() => health('v1', 'v2')),
    origin,
    scope,
    windowOf() as never,
  );
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
  expect(behind.ready).toBe('v2');

  const current = new Standing(
    doorOver(() => health('v2', 'v2')),
    origin,
    scope,
    windowOf() as never,
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(current.ready).toBeNull();

  const checkout = new Standing(
    doorOver(() => health(null, 'v2')),
    origin,
    scope,
    windowOf() as never,
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(checkout.ready).toBeNull();
});

test('a restart asks the server to leave and holds the act until the window closes', async () => {
  let closeWindow: (arrival: Arrival) => void = () => undefined;
  const window = windowOf(new Promise<Arrival>((resolve) => (closeWindow = resolve)));
  let asked: unknown = null;
  const standing = new Standing(
    doorOver(
      () => health('v1', 'v2'),
      (options?: unknown) => {
        asked = options;
        return Promise.resolve();
      },
    ),
    origin,
    scope,
    window as never,
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(standing.ready).toBe('v2');

  const running = standing.restart();
  await Promise.resolve();
  await Promise.resolve();
  expect(asked).toEqual({});
  expect(standing.acting).toEqual({ _tag: 'Restart', onto: 'v2', update: null });
  expect(window.opened).toEqual([{ acted: true, leaving: 1 }]);

  closeWindow(RETURNED);
  await running;
  expect(standing.acting).toBeNull();
  expect(standing.restarting).toBeNull();
  expect(standing.problem).toBeNull();
});

test('a restart the server records as failed is said in the bar with its reason, and the restart stands down', async () => {
  const standing = new Standing(
    doorOver(() => health('v1', 'v2')),
    origin,
    scope,
    windowOf(Promise.resolve({ _tag: 'Stayed', failure: 'migration 7 failed' })) as never,
  );
  await Promise.resolve();
  await Promise.resolve();

  await standing.restart();

  expect(standing.restarting).toBeNull();
  expect(standing.problem?.details).toEqual(['migration 7 failed']);
});

const installingAs = (then: 'restart' | null) => ({
  offer: 'tree',
  title: 'Working tree',
  target: 'abc1234-dirty',
  since: '2026-09-18T00:00:01.000Z',
  log: '/d/build.log',
  then,
  steps: [{ id: 'build', title: 'Build', weight: 5 }],
  step: 'build',
  progress: null,
  tail: null,
  usually: null,
});

const endedAs = (then: 'restart' | null, more: Record<string, unknown> = {}) => ({
  offer: 'tree',
  title: 'Working tree',
  target: 'abc1234-dirty',
  outcome: 'landed' as const,
  build: 'abc1234-dirty v2',
  detail: 'installation abc1234-dirty v2 stands',
  endedAt: '2026-09-18T00:01:00.000Z',
  log: '/d/build.log',
  since: '2026-09-18T00:00:01.000Z',
  tail: [],
  then,
  restartRefused: null,
  ...more,
});

test('an installation is followed until the server says it ended, and a failed one is said with its log', async () => {
  const started = installingAs(null);
  let readings = 0;
  const door = {
    ask: (call: (api: unknown) => unknown) => call({ health: { health: () => Promise.resolve(health(null, null)) } }),
    perform: performOver({
      read_machine_state: () =>
        Promise.resolve({
          machine:
            ++readings < 3
              ? machineWith({ installing: started })
              : machineWith({ installed: endedAs(null, { outcome: 'failed', build: null, detail: 'the build ended with code 3' }) }),
        }),
      install_next: () => Promise.resolve({ installing: started }),
    }),
  } as never;
  const standing = new Standing(door, origin, scope, windowOf() as never);
  await Promise.resolve();
  await Promise.resolve();

  const sleeps: number[] = [];
  const running = standing.install('tree', (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(standing.acting).toEqual({ _tag: 'Install', installing: started });
  await running;
  expect(standing.acting).toBeNull();
  expect(sleeps.length).toBeGreaterThanOrEqual(2);
  expect(standing.next?.installed?.outcome).toBe('failed');
});

const updateDoor = (standings: () => unknown, healths: () => unknown, asked: unknown[]) =>
  ({
    ask: (call: (api: unknown) => unknown) =>
      call({
        health: {
          health: () => {
            const answer = healths();
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
          },
        },
      }),
    perform: performOver({
      read_machine_state: () => {
        const answer = standings();
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ machine: answer });
      },
      install_next: (payload) => {
        asked.push(payload);
        return Promise.resolve({ installing: updating });
      },
      stop_installing: () => {
        asked.push('stop');
        return Promise.resolve({});
      },
    }),
  }) as never;

const updating = installingAs('restart');

test('an update asks the installation to restart, follows it through the silence of the restart, and hands the successor to the window', async () => {
  vi.useFakeTimers();
  const asked: unknown[] = [];
  let phase: 'before' | 'installing' | 'leaving' = 'before';
  let closeWindow: (arrival: Arrival) => void = () => undefined;
  const window = windowOf(new Promise<Arrival>((resolve) => (closeWindow = resolve)));
  const standing = new Standing(
    updateDoor(
      () => (phase === 'before' ? machineWith() : phase === 'installing' ? machineWith({ installing: updating }) : new Error('refused')),
      () => (phase === 'leaving' ? new Error('refused') : health('v1', 'v1')),
      asked,
    ),
    origin,
    scope,
    window as never,
  );
  await vi.advanceTimersByTimeAsync(0);

  const running = standing.update('tree', (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  phase = 'installing';
  await vi.advanceTimersByTimeAsync(0);
  expect(asked).toEqual([{ offer: 'tree', then: 'restart' }]);
  expect(standing.acting).toMatchObject({ _tag: 'Install', installing: { then: 'restart' } });
  await vi.advanceTimersByTimeAsync(4_000);
  expect(window.opened).toEqual([]);

  phase = 'leaving';
  await vi.advanceTimersByTimeAsync(2_500);
  expect(standing.acting).toMatchObject({ _tag: 'Restart', update: { offer: 'tree' } });
  expect(window.opened).toEqual([{ acted: true, leaving: 1 }]);

  closeWindow(RETURNED);
  await running;
  expect(standing.acting).toBeNull();
});

test('an update the operator stops ends the act quietly: nothing restarts, nothing is said', async () => {
  vi.useFakeTimers();
  const asked: unknown[] = [];
  const window = windowOf();
  const standing = new Standing(
    updateDoor(
      () =>
        asked.includes('stop')
          ? machineWith({ installed: endedAs('restart', { outcome: 'stopped', build: null }) })
          : machineWith({ installing: updating }),
      () => health('v1', 'v1'),
      asked,
    ),
    origin,
    scope,
    window as never,
  );
  await vi.advanceTimersByTimeAsync(0);

  const running = standing.update('tree', (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  await vi.advanceTimersByTimeAsync(2_500);
  expect(standing.acting).toMatchObject({ _tag: 'Install', installing: { then: 'restart' } });

  await standing.stop(updating.since);
  expect(standing.stopping).toBe(updating.since);
  await vi.advanceTimersByTimeAsync(5_000);
  await running;
  expect(asked).toContain('stop');
  expect(standing.acting).toBeNull();
  expect(standing.restarting).toBeNull();
  expect(standing.problem).toBeNull();
  expect(window.opened).toEqual([]);
});

test('an update whose restart the server refused is said, and no window opens', async () => {
  vi.useFakeTimers();
  let read = 0;
  const window = windowOf();
  const standing = new Standing(
    updateDoor(
      () =>
        ++read <= 2
          ? machineWith({ installing: updating })
          : machineWith({ installed: endedAs('restart', { restartRefused: 'nothing stands at current' }) }),
      () => health('v1', 'v1'),
      [],
    ),
    origin,
    scope,
    window as never,
  );
  await vi.advanceTimersByTimeAsync(0);

  const running = standing.update('tree', (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  await vi.advanceTimersByTimeAsync(10_000);
  await running;
  expect(window.opened).toEqual([]);
  expect(standing.acting).toBeNull();
  expect(standing.problem?.details).toEqual(['nothing stands at current']);
});

test('a server that refuses this device makes the connection refused, never quiet', async () => {
  const refused = new Refusal({ gate: false, code: 'device-revoked', reason: 'this device was removed from this server', unblock: [] });
  const wire = new WireState(
    { subscribeFailure: () => () => undefined, subscribeStatus: () => () => undefined, refuse: () => undefined } as never,
    scope,
  );
  const standing = new Standing(
    doorOver(() => refused),
    origin,
    scope,
    windowOf() as never,
    null,
    null,
    wire,
  );
  await standing.read();
  expect(wire.refusal).toBe('device-revoked');
  expect(standing.quietSince).toBeNull();
});

const sourceLive = () => {
  let receive: (frame: NextFrame) => void = () => undefined;
  let fail: (failure: LiveFailure) => void = () => undefined;
  const connection = {
    subscribeStatus: () => () => undefined,
    hold: (_open: unknown, onItem: typeof receive, onFailure: typeof fail) => {
      receive = onItem;
      fail = onFailure;
      return {
        unsubscribe: () => {
          receive = () => undefined;
        },
      };
    },
  } as unknown as LiveConnection;
  return {
    connection,
    send: (frame: NextFrame) => receive(frame),
    refuse: (message: string) => fail({ kind: 'subscription', message }),
  };
};

test('live source revisions update the standing and survive a delayed older machine reading', async () => {
  const live = sourceLive();
  const initial = machineWith({ standing: frameOf(1, 4).standing });
  const requested = Promise.withResolvers<void>();
  const response = Promise.withResolvers<{ machine: typeof initial }>();
  let pending = false;
  const door = {
    ask: () => Promise.resolve(health('same', 'same')),
    perform: () => {
      if (!pending) return Promise.resolve({ machine: initial });
      requested.resolve();
      return response.promise;
    },
  };
  const standing = new Standing(door as never, origin, scope, windowOf() as never, live.connection);
  await standing.read();
  expect(standing.next?.standing.behindBy).toBe(4);

  pending = true;
  const rereading = standing.read();
  await requested.promise;
  live.send(frameOf(2, 26));
  expect(standing.next?.standing.behindBy).toBe(26);
  response.resolve({ machine: initial });
  await rereading;
  expect(standing.next?.standing.behindBy).toBe(26);

  live.send(frameOf(1, 4));
  expect(standing.next?.standing.behindBy).toBe(26);
});

test('a refused source subscription is visible, a new snapshot clears it, and disposal ends delivery', async () => {
  const live = sourceLive();
  const disposers: Array<() => void> = [];
  const standing = new Standing(
    updateDoor(
      () => machineWith({ standing: frameOf(1, 4).standing }),
      () => health('same', 'same'),
      [],
    ),
    origin,
    { defer: (dispose: () => void) => disposers.push(dispose) } as never,
    windowOf() as never,
    live.connection,
  );
  await standing.read();
  live.refuse('The source is unreadable.');
  expect(standing.problem?.details).toEqual(['The source is unreadable.']);
  live.send(frameOf(2, 26, { watched: false }));
  expect(standing.problem).not.toBeNull();
  live.send(frameOf(3, 26));
  expect(standing.problem).toBeNull();
  expect(standing.next?.standing.behindBy).toBe(26);
  for (const dispose of disposers.reverse()) dispose();
  live.send(frameOf(4, 27));
  expect(standing.next?.standing.behindBy).toBe(26);
});
