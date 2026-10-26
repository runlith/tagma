import { describe, expect, test } from 'vitest';
import { createRawSnippet } from 'svelte';
import type { ToolView } from './EntryKinds.svelte';
import { chatTimeline } from './TimelineFold';
import type { ThreadToolState as ToolState } from '@runlith/agent/transcript/entries';
import type { ChatEntry } from './entries';
import type { AgentPhase } from '@runlith/agent/AgentPhase';
import type { RunLife, RunStage, RunStatus } from '@runlith/agent/transcript/live';
import { type ChatLiveStatus, chatLiveStatus } from './liveStatus';
import { LivePeek } from './LivePeek';
import { type FeedReading, LIVE_FEED, runVerdict } from './session/FeedVerdicts';
import { VisibleFeed } from './VisibleFeed';
import { builtinEntryKinds } from './builtinKinds';

const kinds = builtinEntryKinds();

const liveEntries = (entries: readonly ChatEntry[], run: string, phase: ChatLiveStatus['phase']) => {
  const feed = new VisibleFeed(kinds);
  feed.load(entries, true, { id: run, phase });
  return feed.live.slice();
};

const now = 1_700_000_000_000;
const runId = 'run-1';
const view = { expanded: () => false, stretchDefault: (_key: string, newest: boolean) => newest, toolOpen: () => undefined };
type Reading = {
  activeRunId: string | null;
  phase: AgentPhase | null;
  stage: RunStage | null;
  life: RunLife | null;
  runStartedAt: number | null;
};
const status = (overrides: Partial<Reading> = {}) => {
  const reading: Reading = {
    activeRunId: runId,
    phase: { phase: 'compacting', since: now - 78_000 },
    stage: 'streaming',
    life: 'working',
    runStartedAt: now - 3_139_000,
    ...overrides,
  };
  const run: RunStatus = {
    threadId: 'thread-1',
    runId: reading.activeRunId,
    life: reading.life ?? 'working',
    stage: reading.stage,
    openQuestions: [],
    since: null,
    receipts: [],
  };
  const feed: FeedReading = reading.life !== null ? LIVE_FEED : { kind: 'lost', reason: 'The live connection closed.', asOf: now };
  return chatLiveStatus(runVerdict(run, feed, reading.phase, reading.runStartedAt), now);
};

function call(id: string, state: ToolState = 'output-available', run = runId): ChatEntry {
  return { id, runId: run, kind: 'tool', toolCallId: id, toolName: 'read', toolState: state };
}

function work(entries: readonly ChatEntry[], phase: Parameters<typeof liveEntries>[2], status = false) {
  return { runId, entries: liveEntries(entries, runId, phase), status };
}

const open = { ...view, expanded: () => true };

function shape(rows: ReturnType<typeof chatTimeline>) {
  return rows.map((row) =>
    row.kind === 'step' || row.kind === 'status'
      ? { rail: row.stretch, place: row.place, spaced: row.spaced, estimate: row.estimate }
      : { rail: row.key, spaced: row.spaced, estimate: row.estimate },
  );
}

describe('live work and history projection', () => {
  test('closing history cannot hide active work and settling returns its identity to history', () => {
    const completed = Array.from({ length: 9 }, (_, index) => call(`call-${index}`));
    const live = call('call-live', 'input-available');
    const entries = [...completed, live];
    const closed = chatTimeline(kinds, entries, view, work(entries, 'tools'));
    expect(closed.map((row) => row.kind)).toEqual(['stretch', 'step']);
    expect(closed[0]?.kind === 'stretch' && closed[0].group.entries.length).toBe(9);
    expect(closed[1]?.key).toBe(live.id);
    const expanded = chatTimeline(kinds, entries, open, work(entries, 'tools'));
    expect(expanded.filter((row) => row.key === live.id)).toHaveLength(1);
    expect(expanded.at(-1)?.key).toBe(live.id);
    const settled = [...completed, call(live.id)];
    const after = chatTimeline(kinds, settled, view, work(settled, 'calling'));
    expect(after).toHaveLength(1);
    expect(after[0]?.kind === 'stretch' && after[0].group.entries.map((entry) => entry.id)).toEqual(settled.map((entry) => entry.id));
  });

  test('every concurrent call stays outside history, with no duplicate row', () => {
    const entries = [call('done'), call('a', 'input-available'), call('b', 'input-streaming')];
    const rows = chatTimeline(kinds, entries, view, work(entries, 'tools'));
    expect(rows.map((row) => row.key)).toEqual(['done', 'a', 'b']);
    expect(rows.filter((row) => row.kind === 'step' && row.live).map((row) => row.key)).toEqual(['a', 'b']);
  });

  test("the run's current work — its status line or its one open call — stands in one place on the stretch's rail", () => {
    const done = [call('d1'), call('d2')];
    const calling = [...done, call('a', 'input-available')];
    const settled = [...done, call('a')];
    for (const reader of [view, open]) {
      const thinking = shape(chatTimeline(kinds, done, reader, work(done, 'calling', true)));
      expect(shape(chatTimeline(kinds, calling, reader, work(calling, 'tools')))).toEqual(thinking);
      expect(thinking.map((row) => row.spaced)).toEqual([...thinking.slice(1).map(() => false), true]);
    }
    expect(shape(chatTimeline(kinds, settled, view, work(settled, 'calling', true)))).toEqual(
      shape(chatTimeline(kinds, done, view, work(done, 'calling', true))),
    );
  });

  test('several open calls and the status line under them continue the stretch on one rail, gapless until the last', () => {
    const entries = [call('done'), call('a', 'input-available'), call('b', 'input-streaming')];
    const rows = shape(chatTimeline(kinds, entries, view, work(entries, 'tools', true)));
    expect(rows.map(({ place, spaced }) => [place, spaced])).toEqual([
      ['first', false],
      ['middle', false],
      ['middle', false],
      ['last', true],
    ]);
  });

  test("with no stretch of the run above, the live rows form their own rail — and another run's stretch is never continued", () => {
    const spoke: ChatEntry = { id: 'said', runId, kind: 'assistant', text: 'on it' };
    const afterWords = [spoke, call('a', 'input-available'), call('b', 'input-available')];
    expect(
      shape(chatTimeline(kinds, afterWords, view, work(afterWords, 'tools', true))).map(({ place, spaced }) => [place, spaced]),
    ).toEqual([
      [undefined, true],
      ['first', false],
      ['middle', false],
      ['last', true],
    ]);
    const earlier = [call('x', 'output-available', 'run-0'), call('y', 'output-available', 'run-0')];
    expect(shape(chatTimeline(kinds, earlier, view, work(earlier, 'calling', true))).map(({ place, spaced }) => [place, spaced])).toEqual([
      [undefined, true],
      ['only', true],
    ]);
  });

  test('compaction and retry are live only for their own run and lifetime', () => {
    const compact: ChatEntry = { id: 'compact', runId, kind: 'compaction', mode: 'automatic', compactionStatus: 'running' };
    const retry: ChatEntry = { id: 'retry', runId, kind: 'retry', attempt: 1, of: 5, family: 'network', delayMs: 1000 };
    expect(liveEntries([compact], runId, 'compacting')).toEqual([compact]);
    expect(liveEntries([compact], 'another', 'compacting')).toEqual([]);
    expect(liveEntries([retry], runId, 'retrying')).toEqual([retry]);
    expect(liveEntries([retry], runId, 'calling')).toEqual([]);
  });
});

describe('server-clocked run status', () => {
  test('phase changes do not reset the whole-run clock', () => {
    expect(status()).toMatchObject({ phase: 'compacting', waiting: null, phaseMs: 78_000, elapsedMs: 3_139_000, pulse: true });
    expect(status({ phase: { phase: 'calling', since: now - 3000 } })).toMatchObject({
      phase: 'calling',
      waiting: null,
      phaseMs: 3000,
      elapsedMs: 3_139_000,
      pulse: true,
    });
  });

  test('unknown phase never invents a model phase and life is the server verdict', () => {
    expect(status({ phase: null })?.phase).toBe('working');
    for (const [life, phase] of [
      [null, 'reconnecting'],
      ['awaiting', 'awaiting'],
      ['idle', 'unresponsive'],
    ] as const) {
      expect(status({ life })).toMatchObject({ phase, waiting: null, phaseMs: null, elapsedMs: 3_139_000, pulse: false });
    }
    expect(status({ activeRunId: null })).toBeNull();
    expect(status({ runStartedAt: null })?.elapsedMs).toBeNull();
  });

  test('a run whose driver is being recovered carries the reason the server named', () => {
    const halt = { reason: 'The agent driver failed: the pipe closed. The run is being driven again (attempt 1 of 2).' };
    const run: RunStatus = {
      threadId: 'thread-1',
      runId,
      life: 'stalled',
      stage: 'running',
      openQuestions: [],
      since: null,
      receipts: [],
      halt,
    };
    expect(runVerdict(run, LIVE_FEED, null, null)?.reason).toBe(halt.reason);
  });
});

describe('floating live projection', () => {
  const status: ChatLiveStatus = {
    phase: 'tools',
    waiting: null,
    elapsedMs: 0,
    phaseMs: 0,
    pulse: true,
    reason: null,
    asOf: null,
  };

  function call(id: string, at: number, done = false, runId = 'run'): ChatEntry {
    return {
      id,
      runId,
      kind: 'tool',
      toolName: 'read',
      toolCallId: id,
      toolState: done ? 'output-available' : 'input-available',
      occurredAt: new Date(at).toISOString(),
    };
  }

  function fixture() {
    const feed = new VisibleFeed(kinds);
    return { feed, peek: new LivePeek(feed) };
  }

  test('short calls are skipped and a shown call keeps its real completion until its minimum display ends', () => {
    const { feed, peek } = fixture();
    feed.load([call('short', 1000)], true, { id: 'run', phase: 'tools' });
    expect(peek.read(status, 1000, true)).toMatchObject({ value: { kind: 'working' }, nextAt: 1250 });
    feed.load([call('short', 1000, true), call('next', 1080)], true, { id: 'run', phase: 'tools' });
    expect(peek.read(status, 1080, true)).toMatchObject({ value: { kind: 'working' }, nextAt: 1330 });
    feed.load([call('short', 1000, true), call('next', 1080, true)], true, { id: 'run', phase: 'calling' });
    expect(peek.read(status, 1160, true)).toMatchObject({ value: { kind: 'working' }, nextAt: null });

    feed.load([call('long', 2000)], true, { id: 'run', phase: 'tools' });
    expect(peek.read(status, 2249, true)).toMatchObject({ value: { kind: 'working' }, nextAt: 2250 });
    expect(peek.read(status, 2250, true)).toMatchObject({ value: { kind: 'step', entry: { id: 'long' }, live: true }, nextAt: null });
    feed.load([call('long', 2000, true), call('skipped', 2260)], true, { id: 'run', phase: 'tools' });
    expect(peek.read(status, 2260, true)).toMatchObject({
      value: { kind: 'step', entry: { id: 'long', toolState: 'output-available' }, live: false },
      nextAt: 2750,
    });
    feed.load([call('long', 2000, true), call('skipped', 2260, true)], true, { id: 'run', phase: 'calling' });
    expect(peek.read(status, 2749, true).value).toMatchObject({ kind: 'step', entry: { id: 'long' }, live: false });
    expect(peek.read(status, 2750, true)).toMatchObject({ value: { kind: 'working' }, nextAt: null });
  });

  test('an already old call appears on scrolling up and is not displaced by concurrent calls', () => {
    const { feed, peek } = fixture();
    feed.load([call('old', 1000)], true, { id: 'run', phase: 'tools' });
    expect(peek.read(status, 2000, false)).toMatchObject({ value: { kind: 'working' }, nextAt: null });
    expect(peek.read(status, 2000, true).value).toMatchObject({ kind: 'step', entry: { id: 'old' }, live: true });
    feed.load([call('old', 1000), call('parallel', 2100)], true, { id: 'run', phase: 'tools' });
    expect(peek.read(status, 2400, true).value).toMatchObject({ kind: 'step', entry: { id: 'old' }, live: true });
    feed.load([call('old', 1000, true), call('parallel', 2100)], true, { id: 'run', phase: 'tools' });
    expect(peek.read(status, 2401, true)).toMatchObject({ value: { kind: 'step', entry: { id: 'old' }, live: false }, nextAt: 2500 });
    expect(peek.read(status, 2500, true).value).toMatchObject({ kind: 'step', entry: { id: 'parallel' }, live: true });
  });

  test('completion holds retry and a tool with its own view independently of row presentation', () => {
    const custom = builtinEntryKinds();
    const view: ToolView = createRawSnippet(() => ({ render: () => '<span></span>' }));
    custom.register('card', { kind: 'tool', view: () => view });
    const retry: ChatEntry = {
      id: 'retry',
      runId: 'run',
      kind: 'retry',
      attempt: 1,
      of: 3,
      family: 'network',
      delayMs: 1000,
      occurredAt: new Date(1000).toISOString(),
    };
    for (const entry of [call('card', 1000), retry]) {
      const feed = new VisibleFeed(custom);
      const peek = new LivePeek(feed);
      feed.load([entry], true, { id: 'run', phase: entry.kind === 'retry' ? 'retrying' : 'tools' });
      expect(peek.read(status, 1250, true).value).toMatchObject({ kind: 'step', entry: { id: entry.id }, live: true });
      const completed = entry.kind === 'tool' ? call('card', 1000, true) : entry;
      feed.load([completed], true, { id: 'run', phase: 'calling' });
      expect
        .soft(peek.read(status, 1300, true))
        .toMatchObject({ value: { kind: 'step', entry: { id: entry.id }, live: false }, nextAt: 1750 });
    }
  });

  test('entry ages use the session clock offset while display deadlines remain in local time', () => {
    for (const offset of [-10_000, 10_000]) {
      const { feed, peek } = fixture();
      feed.load([call('fresh', 1000 + offset)], true, { id: 'run', phase: 'tools' });
      expect.soft(peek.read(status, 1000, true, offset)).toMatchObject({ value: { kind: 'working' }, nextAt: 1250 });
      expect.soft(peek.read(status, 1250, true, offset).value).toMatchObject({ kind: 'step', entry: { id: 'fresh' } });
      feed.load([call('fresh', 1000 + offset, true)], true, { id: 'run', phase: 'calling' });
      expect.soft(peek.read(status, 1300, true, offset).nextAt).toBe(1750);
      feed.load([call('already-long', 500 + offset, false, 'next-run')], true, { id: 'next-run', phase: 'tools' });
      expect.soft(peek.read(status, 2000, true, offset).value).toMatchObject({ kind: 'step', entry: { id: 'already-long' } });
    }
  });

  test('attention, a finished run, a hidden button and a new run never retain old working state', () => {
    const { feed, peek } = fixture();
    feed.load([call('old', 1000)], true, { id: 'run', phase: 'tools' });
    expect(peek.read(status, 2000, true).value).toMatchObject({ kind: 'step', entry: { id: 'old' } });
    const awaiting: ChatLiveStatus = { ...status, phase: 'awaiting', pulse: false };
    expect(peek.read(awaiting, 2010, true)).toMatchObject({ value: { kind: 'status', status: awaiting }, nextAt: null });
    expect(peek.read(null, 2020, true)).toEqual({ value: null, nextAt: null });

    feed.load([call('new', 2030, false, 'new-run')], true, { id: 'new-run', phase: 'tools' });
    expect(peek.read(status, 2030, true)).toMatchObject({ value: { kind: 'working' }, nextAt: 2280 });
    expect(peek.read(status, 2280, true).value).toMatchObject({ kind: 'step', entry: { id: 'new' } });
    expect(peek.read(status, 2290, false)).toMatchObject({ value: { kind: 'working' }, nextAt: null });
    expect(peek.read(status, 2300, true).value).toMatchObject({ kind: 'step', entry: { id: 'new' } });
    feed.load([call('new', 2030, true, 'new-run')], true, { id: 'new-run', phase: 'calling' });
    expect(peek.read(status, 2310, true).nextAt).toBe(2800);
    feed.load([], true, { id: 'third-run', phase: 'calling' });
    expect(peek.read(status, 2320, true)).toMatchObject({ value: { kind: 'working' }, nextAt: null });
  });
});
