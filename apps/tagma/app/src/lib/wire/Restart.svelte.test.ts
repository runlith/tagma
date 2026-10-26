// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { RESTARTING_CLOSE } from '@tagma/server/platform/contract/wire/live';
import type { PlatformStorage } from '@runlith/layer/Platform';
import { makeRouter, makeStorage } from '@runlith/layer/testing';
import { Refusal } from './refusal.js';
import { Restart } from './Restart.svelte.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

type Answer = {
  status: 'starting' | 'ready' | 'failed';
  pid: number;
  phase: string;
  step: { name: string; index: number; total: number } | null;
};

const startup = (answer: Answer) => ({
  startup: {
    ...answer,
    startedAt: 1,
    readyAt: answer.status === 'ready' ? 2 : null,
    expectedMs: null,
    failure: null,
  },
  issue: null,
});

const ready = (pid: number) => startup({ status: 'ready', pid, phase: 'serving', step: null });
const starting = (pid: number) => startup({ status: 'starting', pid, phase: 'stores opening', step: { name: 'm1', index: 1, total: 3 } });
const leaving = (failure: string | null = null) => ({
  startup: null,
  issue: null,
  restart: {
    id: 'restart-1',
    stage: failure === null ? 'accepted' : 'failed',
    underway: failure === null,
    failure,
    stays: failure !== null,
  },
});

const storageOf = (): PlatformStorage => makeStorage();

const liveOf = () => {
  let status: (value: string) => void = () => undefined;
  let failure: (value: { code?: number }) => void = () => undefined;
  return {
    live: {
      subscribeStatus: (listener: typeof status) => {
        status = listener;
        return () => undefined;
      },
      subscribeFailure: (listener: typeof failure) => {
        failure = listener;
        return () => undefined;
      },
    },
    status: (value: string) => status(value),
    fail: (code: number) => failure({ code }),
  };
};

const doorOf = (answers: () => unknown, reported: unknown[] = []) =>
  ({
    ask: (call: (api: unknown) => unknown) =>
      call({
        health: {
          startup: () => {
            const answer = answers();
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
          },
          health: () => Promise.resolve({}),
        },
      }),
    perform: (id: string, input: unknown) => {
      if (id === 'read_machine_state') return Promise.resolve({ machine: { restart: { record: { id: 'restart-1' } } } });
      reported.push(input);
      return Promise.resolve({});
    },
  }) as never;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const scope = { defer: () => undefined } as never;

type World = { storage: PlatformStorage; behind?: () => Promise<boolean>; reload?: () => void };

const restartOf = (door: never, live: ReturnType<typeof liveOf>, world: World) =>
  new Restart(
    door,
    live.live as never,
    new ServerOrigin('http://localhost'),
    world.storage,
    { behind: world.behind ?? (() => Promise.resolve(false)) },
    makeRouter({ reload: world.reload }),
    scope,
    { sleep, now: () => Date.now() },
  );

afterEach(() => {
  vi.useRealTimers();
});

test('a restart the page asked for shows the successor starting, reloads once when the build moved, and the reloaded page reports its window when the thread returns', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const storage = storageOf();
  const reload = vi.fn();
  let phase: 'old' | 'gap' | 'starting' | 'up' = 'old';
  const answers = () =>
    phase === 'old' ? leaving() : phase === 'gap' ? new Error('refused') : phase === 'starting' ? starting(2) : ready(2);
  const before = restartOf(doorOf(answers), liveOf(), { storage, behind: () => Promise.resolve(true), reload });

  void before.open(true, 1);
  await vi.advanceTimersByTimeAsync(300);
  expect(before.since).toBe(100_000);
  expect(before.announced).toBe(true);

  phase = 'gap';
  await vi.advanceTimersByTimeAsync(500);
  expect(before.quietSince).not.toBeNull();

  phase = 'starting';
  await vi.advanceTimersByTimeAsync(300);
  expect(before.startup).toMatchObject({ status: 'starting', phase: 'stores opening', step: { index: 1, total: 3 } });
  expect(before.quietSince).toBeNull();
  expect(reload).not.toHaveBeenCalled();

  phase = 'up';
  await vi.advanceTimersByTimeAsync(300);
  expect(reload).toHaveBeenCalledTimes(1);

  const reported: unknown[] = [];
  const live = liveOf();
  const after = restartOf(doorOf(answers, reported), live, { storage, behind: () => Promise.resolve(true), reload });
  expect(after.since).toBe(100_000);
  await vi.advanceTimersByTimeAsync(300);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(after.returning).toBe(true);

  const unwatch = after.watch();
  live.status('open');
  vi.setSystemTime(104_200);
  after.placeReturned(3, 'thread-1');
  await vi.advanceTimersByTimeAsync(0);
  expect(after.since).toBeNull();
  expect(storage.getItem('tagma.restart')).toBeNull();
  expect(reported).toEqual([
    { restartId: 'restart-1', clientId: expect.any(String), door: 'local', projectId: 3, threadId: 'thread-1', durationMs: 4_200 },
  ]);
  unwatch();
});

test('a dropped connection to a server that never stopped answering closes its window without a report', async () => {
  vi.useFakeTimers();
  const live = liveOf();
  const reported: unknown[] = [];
  const restart = restartOf(
    doorOf(() => ready(1), reported),
    live,
    { storage: storageOf() },
  );

  live.status('closed');
  expect(restart.since).not.toBeNull();
  expect(restart.announced).toBe(false);
  await vi.advanceTimersByTimeAsync(300);

  expect(restart.since).toBeNull();
  expect(reported).toEqual([]);
});

test('a dropped connection to a server that answers its startup state with a fault closes its window', async () => {
  vi.useFakeTimers();
  const live = liveOf();
  const fault = new Refusal({ gate: false, code: 'http', reason: '500 Internal Server Error', unblock: [] });
  const restart = restartOf(
    doorOf(() => fault),
    live,
    { storage: storageOf() },
  );

  live.status('closed');
  await vi.advanceTimersByTimeAsync(300);
  live.status('open');
  await vi.advanceTimersByTimeAsync(1_500);

  expect(restart.since).toBeNull();
});

test('a server asked to leave is waited for while its restart is under way, however long, and stayed with once the restart records that it serves on', async () => {
  vi.useFakeTimers();
  const live = liveOf();
  let phase: 'underway' | 'blip' | 'failed' = 'underway';
  const restart = restartOf(
    doorOf(() => (phase === 'blip' ? new Error('refused') : leaving(phase === 'failed' ? 'migration 7 failed' : null))),
    live,
    { storage: storageOf() },
  );

  live.fail(RESTARTING_CLOSE);
  expect(restart.announced).toBe(true);
  let arrived: unknown = null;
  void restart.open(true, 1).then((arrival) => (arrived = arrival));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(arrived).toBeNull();
  expect(restart.since).not.toBeNull();

  phase = 'blip';
  await vi.advanceTimersByTimeAsync(300);
  phase = 'failed';
  await vi.advanceTimersByTimeAsync(300);
  expect(arrived).toEqual({ _tag: 'Stayed', failure: 'migration 7 failed' });
  expect(restart.since).toBeNull();
});

test('a successor that already serves when the first poll after the close code lands is arrived at, not stayed with', async () => {
  vi.useFakeTimers();
  const live = liveOf();
  const restart = restartOf(
    doorOf(() => ({ ...ready(2), restart: { id: 'restart-1', stage: 'serving', underway: false, failure: null, stays: false } })),
    live,
    { storage: storageOf() },
  );

  live.fail(RESTARTING_CLOSE);
  await vi.advanceTimersByTimeAsync(300);

  expect(restart.returning).toBe(true);
  expect(restart.since).not.toBeNull();
});

test('a page that is behind the served build reloads on its own only while no restart window is open', async () => {
  vi.useFakeTimers();
  const reload = vi.fn();
  const restart = restartOf(
    doorOf(() => ready(1)),
    liveOf(),
    { storage: storageOf(), behind: () => Promise.resolve(true), reload },
  );

  await restart.reloadIfBehind();
  expect(reload).toHaveBeenCalledTimes(1);

  void restart.open(true, 1);
  await restart.reloadIfBehind();
  expect(reload).toHaveBeenCalledTimes(1);
});

test('a thread frame that lands before the poll sees the successor still reports the window, measured to that frame', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const reported: unknown[] = [];
  const live = liveOf();
  let phase: 'gap' | 'up' = 'gap';
  const restart = restartOf(
    doorOf(() => (phase === 'gap' ? new Error('refused') : ready(2)), reported),
    live,
    { storage: storageOf() },
  );

  live.status('closed');
  await vi.advanceTimersByTimeAsync(500);
  restart.watch();
  live.status('open');
  vi.setSystemTime(13_000);
  restart.placeReturned(3, 'thread-1');
  vi.setSystemTime(15_000);
  phase = 'up';
  await vi.advanceTimersByTimeAsync(300);

  expect(restart.since).toBeNull();
  expect(reported).toEqual([
    { restartId: 'restart-1', clientId: expect.any(String), door: 'local', projectId: 3, threadId: 'thread-1', durationMs: 3_000 },
  ]);
});
