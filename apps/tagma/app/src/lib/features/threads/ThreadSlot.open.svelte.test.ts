// @vitest-environment jsdom

import type { WireSnapshot, WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import type { ChatFeedEvent } from '@runlith/chat-ui/wire/ChatConnection';
import { Scope } from '@runlith/layer/Scope';
import { Clock, Context, Effect, Queue } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import { TestClock } from 'effect/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { testThreadChat, testThreadSlot, commitRoute } from '$lib/app/slotWorld.js';
import type { ThreadSlot } from './ThreadSlot.svelte.js';
import { recordThreadOpen, threadOpenTally, threadOpens, type ThreadOpenTiming } from './threadOpenRecord.js';
import { ThreadOpenWatch } from './OpenWatch.js';
import { Runner } from './Runner.js';
import { ThreadPlace } from './thread/ThreadPlace.svelte.js';

let lives: Scope[] = [];
let frames: (() => void)[] = [];
let port = new TestConnection<WireThread>();
let testClock: TestClock.TestClock;
const runnerOf = (): Runner => new Runner(Context.make(Clock.Clock, testClock));

const now = (): number => Number(testClock.monotonicTimeNanosUnsafe()) / 1_000_000;
const setClock = (ms: number) => testClock.setTime(ms);
const clock = Effect.gen(function* () {
  testClock = yield* TestClock.make();
  yield* setClock(1000);
});

function open(): ThreadSlot {
  const scope = Scope.make();
  lives.push(scope);
  return testThreadSlot(
    { projectId: 47, chat: testThreadChat(port), list: { threads: [], row: () => undefined } as never },
    { runner: runnerOf() },
    scope,
  );
}

function runFrames(): void {
  const due = frames;
  frames = [];
  for (const step of due) step();
}

function snapshot(threadId: string, transcript: readonly ThreadTranscriptEntry[] = [], agentId = 'tagma'): WireSnapshot {
  return {
    thread: { id: threadId, agentId, capabilities: NATIVE_CAPABILITIES },
    transcript,
    before: null,
    open: [],
    progress: null,
    activeRun: null,
    latestRun: null,
    pendingInput: { queued: [], steers: [] },
    status: { threadId: 'thread-1', runId: null, life: 'idle', stage: null, openQuestions: [], since: null, receipts: [] },
    now: '2026-09-14T20:00:00.000Z',
  } as unknown as WireSnapshot;
}

const said = [
  { type: 'message', id: 'message:user:run-1', role: 'user', runId: 'run-1', text: 'hello' },
  { type: 'message', id: 'assistant:run-1', role: 'assistant', runId: 'run-1', text: 'hi' },
] as unknown as readonly ThreadTranscriptEntry[];

function event(snapshot: WireSnapshot): ChatFeedEvent<WireThread> {
  return { type: 'snapshot', at: { position: 0, seq: 1 }, payload: { status: 'loaded', snapshot } } as never;
}

async function arrived(threadId: string, transcript: readonly ThreadTranscriptEntry[] = [], agentId = 'tagma'): Promise<void> {
  port.emit(event(snapshot(threadId, transcript, agentId)), threadId);
  await settle();
}

async function failed(threadId: string, message: string): Promise<void> {
  port.refuse(message, threadId);
  await settle();
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const DEADLINE_MS = 10_000;

function armed(): number {
  return DEADLINE_MS;
}

type ChatStages = Omit<Extract<ThreadOpenTiming, { kind: 'chat' }>, 'host'>;

function stages(entry: PerformanceMeasure | undefined): ChatStages {
  const { host: _host, ...rest } = entry?.detail as Extract<ThreadOpenTiming, { kind: 'chat' }>;
  return rest;
}

function measured(at: number, totalMs: number): ThreadOpenTiming {
  return {
    kind: 'chat',
    host: 1,
    threadId: `thread-${at}`,
    entries: 0,
    replayed: false,
    reached: 'frame',
    selectToSubscribeMs: 0,
    subscribeWaitMs: totalMs,
    applyMs: 0,
    applyToFrameMs: 0,
    totalMs,
  };
}

beforeEach(() => {
  performance.clearMeasures();
  performance.clearMarks();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (step: () => void) => {
    frames.push(step);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames = frames.filter((_, at) => at !== id - 1);
  });
  port = new TestConnection<WireThread>();
  lives = [];
});

afterEach(async () => {
  for (const scope of lives) await scope.close();
  lives = [];
  performance.clearMeasures();
  performance.clearMarks();
});

it.live('a routed open completes at the frame after its first snapshot with exact stages', () =>
  Effect.gen(function* () {
    yield* clock;
    const host = open();
    host.activateRoute('thread-1', 47);
    yield* setClock(1100);
    yield* Effect.promise(() => arrived('thread-1'));
    yield* setClock(1116);
    runFrames();
    const first = threadOpens();
    expect(first).toHaveLength(1);
    expect(first.at(0)?.name).toBe('tagma.thread-open');
    expect(stages(first.at(0))).toEqual({
      kind: 'chat',
      threadId: 'thread-1',
      entries: 0,
      replayed: false,
      reached: 'frame',
      selectToSubscribeMs: 0,
      subscribeWaitMs: 100,
      applyMs: 0,
      applyToFrameMs: 16,
      totalMs: 116,
    } satisfies ChatStages);
    expect(first.at(0)?.startTime).toBe(1000);
    expect(first.at(0)?.duration).toBe(116);

    host.activateRoute('thread-2', 47);
    yield* setClock(1200);
    yield* Effect.promise(() => arrived('thread-2', said));
    yield* setClock(1210);
    runFrames();
    const both = threadOpens();
    expect(both.map((entry) => (entry.detail as ThreadOpenTiming).threadId)).toEqual(['thread-1', 'thread-2']);
    expect(stages(both.at(1))).toMatchObject({ entries: 2, subscribeWaitMs: 84, applyToFrameMs: 10, totalMs: 94 });
    expect(threadOpenTally()).toMatchObject({ measured: 2, unfinished: 0, dropped: 0, declined: 0 });
  }),
);

it.live('a reselect abandons the earlier open and counts it', () =>
  Effect.gen(function* () {
    yield* clock;
    const host = open();
    host.activateRoute('thread-a', 47);
    const staleA = port.feeds.at(-1)!;
    yield* setClock(1100);
    yield* Effect.promise(() => arrived('thread-a'));
    const scheduled = [...frames];
    host.activateRoute('thread-b', 47);
    for (const step of scheduled) step();
    runFrames();
    expect(threadOpens()).toHaveLength(0);
    expect(threadOpenTally()).toMatchObject({ measured: 0, declined: 1, reasons: { reselect: 1 } });
    yield* setClock(1200);
    yield* Effect.promise(() => arrived('thread-b'));
    yield* setClock(1210);
    runFrames();
    expect(threadOpens()).toHaveLength(1);
    yield* setClock(1300);
    host.activateRoute('thread-a', 47);
    yield* setClock(1350);
    Queue.offerUnsafe(staleA.queue, event(snapshot('thread-a')));
    yield* Effect.promise(settle);
    yield* setClock(1400);
    yield* Effect.promise(() => arrived('thread-a'));
    yield* setClock(1410);
    runFrames();
    const entries = threadOpens();
    expect(entries).toHaveLength(2);
    expect(stages(entries.at(1))).toMatchObject({ threadId: 'thread-a', subscribeWaitMs: 100, totalMs: 110 });
  }),
);

it.live('errors and disposal measure nothing and count why, and a terminal thread is timed as a harness open, not a chat open', () =>
  Effect.gen(function* () {
    yield* clock;
    const host = open();
    host.activateRoute('thread-a', 47);
    yield* setClock(1100);
    yield* Effect.promise(() => failed('thread-a', 'the feed refused'));
    runFrames();
    expect(threadOpens()).toHaveLength(0);
    expect(threadOpenTally()).toMatchObject({ declined: 1, reasons: { unreadable: 1 } });

    host.activateRoute('thread-b', 47);
    yield* setClock(1200);
    yield* Effect.promise(() => arrived('thread-b'));
    yield* Effect.promise(async () => {
      await lives.at(0)?.close();
    });
    runFrames();
    expect(threadOpens()).toHaveLength(0);
    expect(threadOpenTally()).toMatchObject({ declined: 2, reasons: { unreadable: 1, closed: 1 } });

    const second = open();
    yield* setClock(1300);
    second.activateRoute('thread-c', 47);
    yield* setClock(1350);
    port.emit(
      event({
        ...snapshot('thread-c', [], 'harness'),
        thread: {
          id: 'thread-c',
          agentId: 'harness',
          capabilities: { screen: true },
          harness: {
            transport: 'terminal',
            process: { id: 'p-1', state: 'running', startedAt: '2026-10-09T10:00:00.000Z' },
          },
        },
      } as never),
      'thread-c',
    );
    yield* Effect.promise(settle);
    runFrames();
    expect(second.surface.terminal).not.toBeNull();
    expect(second.harnessOpen).toMatchObject({ kind: 'harness', threadId: 'thread-c', selectedAt: 1300 });
    expect(threadOpens()).toHaveLength(0);
    expect(threadOpenTally()).toMatchObject({ declined: 2, reasons: { unreadable: 1, closed: 1 } });
  }),
);

it.live('a harness open is measured in the five stages of its own arm', () =>
  Effect.gen(function* () {
    yield* clock;
    const watch = new ThreadOpenWatch(runnerOf(), (threadId) => threadId === 'thread-cli');
    watch.select('thread-cli', 'harness');
    const attempt = watch.harness;
    if (attempt === null) return yield* Effect.die('the harness attempt was not opened');
    yield* setClock(1005);
    attempt.reached('record', now());
    yield* setClock(1009);
    attempt.reached('engine', now());
    yield* setClock(1012);
    attempt.reached('attach', now());
    yield* setClock(1044);
    attempt.reached('replay', now());
    yield* setClock(1047);
    attempt.reached('paint', now());
    expect(threadOpens()).toHaveLength(0);
    yield* setClock(1063);
    runFrames();

    const entry = threadOpens().at(0);
    expect(entry?.detail).toEqual({
      kind: 'harness',
      host: expect.any(Number),
      threadId: 'thread-cli',
      recordMs: 5,
      engineMs: 4,
      attachMs: 3,
      replayMs: 32,
      paintMs: 3,
      totalMs: 63,
    });
    expect(entry?.duration).toBe(63);
    expect(threadOpenTally()).toMatchObject({ measured: 1, unfinished: 0, declined: 0 });
  }),
);

it.live('two hosts write one record, and closing one leaves its measurements', () =>
  Effect.gen(function* () {
    yield* clock;
    const first = open();
    first.activateRoute('thread-1', 47);
    yield* setClock(1100);
    yield* Effect.promise(() => arrived('thread-1'));
    yield* setClock(1116);
    runFrames();
    const second = open();
    second.activateRoute('thread-2', 47);
    yield* setClock(1200);
    yield* Effect.promise(() => arrived('thread-2', said));
    yield* setClock(1210);
    runFrames();
    const both = threadOpens();
    expect(both).toHaveLength(2);
    expect(new Set(both.map((entry) => entry.name)).size).toBe(1);
    const hosts = both.map((entry) => (entry.detail as ThreadOpenTiming).host);
    expect(new Set(hosts).size).toBe(2);
    yield* Effect.promise(async () => {
      await lives.at(0)?.close();
    });
    expect(threadOpens()).toHaveLength(2);
  }),
);

it.live('an open that never reaches its frame is measured at its deadline, once', () =>
  Effect.gen(function* () {
    yield* clock;
    const host = open();
    host.activateRoute('thread-slow', 47);
    const wait = armed();
    yield* setClock(1000 + wait);
    yield* Effect.promise(settle);
    const cut = threadOpens();
    expect(cut).toHaveLength(1);
    expect(stages(cut.at(0))).toMatchObject({
      threadId: 'thread-slow',
      reached: 'subscribe',
      selectToSubscribeMs: 0,
      subscribeWaitMs: null,
      applyMs: null,
      applyToFrameMs: null,
      totalMs: wait,
    });
    expect(cut.at(0)?.duration).toBe(wait);
    expect(threadOpenTally()).toMatchObject({ measured: 1, unfinished: 1, declined: 0 });

    yield* setClock(1000 + wait + 50);
    yield* Effect.promise(() => arrived('thread-slow'));
    runFrames();
    expect(threadOpens()).toHaveLength(1);
    expect(threadOpenTally()).toMatchObject({ measured: 1, declined: 0 });
  }),
);

it.live('a snapshot whose frame never comes is measured at the deadline as an unfinished apply', () =>
  Effect.gen(function* () {
    yield* clock;
    const host = open();
    host.activateRoute('thread-1', 47);
    yield* setClock(1100);
    yield* Effect.promise(() => arrived('thread-1'));
    const wait = armed();
    yield* setClock(1000 + wait);
    yield* Effect.promise(settle);
    expect(stages(threadOpens().at(0))).toMatchObject({
      reached: 'apply',
      selectToSubscribeMs: 0,
      subscribeWaitMs: 100,
      applyMs: 0,
      applyToFrameMs: null,
      totalMs: wait,
    });
    expect(threadOpenTally()).toMatchObject({ measured: 1, unfinished: 1, declined: 0 });
    expect(frames).toHaveLength(0);
    runFrames();
    expect(threadOpens()).toHaveLength(1);
  }),
);

it.live('an ask for the thread already open measures nothing and is counted', () =>
  Effect.gen(function* () {
    yield* clock;
    const host = open();
    host.activateRoute('thread-1', 47);
    yield* setClock(1100);
    yield* Effect.promise(() => arrived('thread-1'));
    yield* setClock(1116);
    runFrames();
    expect(threadOpens()).toHaveLength(1);

    host.activateRoute('thread-1', 47);
    host.open('thread-1');
    commitRoute(host);
    expect(threadOpens()).toHaveLength(1);
    expect(threadOpenTally()).toMatchObject({ measured: 1, declined: 2, reasons: { standing: 2 } });

    host.activateRoute(null, 47);
    host.activateRoute(null, 47);
    expect(threadOpenTally()).toMatchObject({ declined: 2, reasons: { standing: 2 } });
  }),
);

test('the trim counts what it drops, so the window is not read as the population', () => {
  const longest = 5000;
  const opens = 129;
  recordThreadOpen(measured(0, longest), 0);
  for (let at = 1; at < opens; at += 1) recordThreadOpen(measured(at, 10 + at), at);
  const kept = threadOpens();
  const tally = threadOpenTally();
  expect(tally).toMatchObject({ measured: opens, unfinished: 0, declined: 0 });
  expect(tally.dropped).toBeGreaterThan(0);
  expect(kept).toHaveLength(tally.measured - tally.dropped);
  expect(Math.max(...kept.map((entry) => entry.duration))).toBeLessThan(longest);
});

it.live('an open thread stands where its own record places it, with no place card in its transcript', () =>
  Effect.gen(function* () {
    yield* clock;
    const host = open();
    host.activateRoute('thread-1', 47);
    const loaded = snapshot('thread-1');
    port.emit(event({ ...loaded, thread: { ...loaded.thread, place: { rootId: 'gone', branch: 'tagma/demo' } } }));
    yield* Effect.promise(settle);
    expect(host.thread?.get(ThreadPlace).recorded).toEqual({ rootId: 'gone', branch: 'tagma/demo' });
  }),
);
