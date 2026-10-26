import type { ToolDisplay } from '@runlith/agent/tool/display';
import { describe, expect, test } from 'vitest';
import type { ActivityEntry } from './activity';
import type { ChatEntry } from './entries';
import { CHAT_TAIL_ITEMS, type ChatTimelineItem, stretchOnScreen, timelineBodyArrivesLate } from './timeline';
import { chatTimeline, TimelineFold } from './TimelineFold';
import { builtinEntryKinds } from './builtinKinds';
import type { ToolView } from './EntryKinds.svelte';
import { ChatFold } from './ChatFold.svelte';
import { type FeedRun, VisibleFeed } from './VisibleFeed';
import type { ThreadOpenChange } from '@runlith/agent/transcript/live';
import { FeedReader } from './session/FeedReader';
import { at, openEvent, snapshotEvent, stateEvent } from './testing/chatHarness.svelte';
import type { TestThread } from './testing/chatConnection';
import type { ChatFeedEvent } from './wire/ChatConnection';

const kinds = builtinEntryKinds();

const user = (id: string, runId?: string, occurredAt?: string): ChatEntry => ({
  id,
  kind: 'user',
  text: 'question',
  runId,
  occurredAt,
});
const assistant = (id: string, runId = 'run-1', occurredAt?: string): ChatEntry => ({
  id,
  kind: 'assistant',
  text: 'answer',
  runId,
  occurredAt,
});
const reasoning = (id: string, runId = 'run-1'): ChatEntry => ({
  id,
  kind: 'reasoning',
  text: 'thinking through the plan',
  runId,
});
const context = (id: string, runId = 'run-1'): ChatEntry => ({ id, kind: 'context', text: 'turn task', runId });
const plugin = (id: string, runId = 'run-1'): ChatEntry => ({
  id,
  kind: 'product',
  product: 'learning-widget',
  payload: {},
  runId,
});
const tool = (id: string, extra?: Partial<Extract<ChatEntry, { kind: 'tool' }>>): ChatEntry => ({
  id,
  kind: 'tool',
  toolName: 'save_sprint_items',
  toolCallId: id,
  toolState: 'output-available',
  runId: 'run-1',
  ...extra,
});
const systemPrompt = (id: string): ChatEntry => ({ id, kind: 'system-prompt', text: 'prompt', runId: 'run-1' });
const compaction = (id: string, runId: string | null = 'run-1'): ChatEntry => ({
  id,
  kind: 'compaction',
  mode: 'automatic',
  compactionStatus: 'completed',
  runId: runId ?? undefined,
});
const signal = (
  id: string,
  addressee: 'reader' | 'transport',
  runId = 'run-1',
  extra?: Partial<Extract<ChatEntry, { kind: 'signal' }>>,
): ChatEntry => ({
  id,
  kind: 'signal',
  signalType: 'any-type',
  addressee,
  text: 'notice',
  runId,
  ...extra,
});
const guidance = (id: string, runId = 'run-1'): ChatEntry => ({
  id,
  kind: 'runtime-guidance',
  runId,
  runtimeGuidance: {
    type: 'runtime-guidance',
    id,
    runId,
    hook: 'beforeStep',
    sequence: 1,
    texts: ['note'],
    sources: [],
  },
});

function reader(expanded: (key: string) => boolean, stretches: 'newest' | 'all' = 'newest') {
  return {
    expanded: (key: string) => expanded(key),
    stretchDefault: (_key: string, newest: boolean) => stretches === 'all' || newest,
    toolOpen: () => undefined,
  };
}

function untouched(stretches: 'newest' | 'all' = 'newest') {
  return {
    expanded: (_key: string, fallback: boolean) => fallback,
    stretchDefault: (_key: string, newest: boolean) => stretches === 'all' || newest,
    toolOpen: () => undefined,
  };
}

function newestOf(entries: readonly ChatEntry[], view?: ReturnType<typeof reader>): string | null {
  const fold = new TimelineFold(kinds);
  fold.load(entries, view);
  return fold.newestKey;
}

function chain(run: FeedRun | null = null) {
  const store = new ChatFold();
  const feed = new VisibleFeed(kinds);
  const rows = new TimelineFold(kinds);
  const steady = untouched();
  return {
    rows,
    show(entries: readonly ChatEntry[], view: ReturnType<typeof untouched> = steady): readonly ChatTimelineItem[] {
      store.entries = entries;
      feed.sync(store, true, run);
      rows.sync(feed, view, run === null ? null : { runId: run.id, status: true }, []);
      return rows.slice();
    },
  };
}

function stretch(items: readonly ChatTimelineItem[], at: number): Extract<ChatTimelineItem, { kind: 'stretch' }> {
  const item = items[at];
  if (item?.kind !== 'stretch') throw new Error('expected a stretch');
  return item;
}

function stretches(items: readonly ChatTimelineItem[]): string[] {
  const keys = items.flatMap((item) => (item.kind === 'stretch' ? [item.key] : item.kind === 'step' ? [item.stretch] : []));
  return [...new Set(keys)];
}

describe('chat timeline run segmentation', () => {
  test('everything renders in emission order; consecutive machinery folds into one stretch', () => {
    const items = chatTimeline(kinds, [user('u1', 'run-1'), reasoning('r1'), tool('t1'), assistant('a1')]);

    expect(stretches(items)).toEqual(['activity:r1']);
    const activity = stretch(items, 1);
    expect(activity.group.id).toBe('run-1');
    expect(activity.group.entries.map((entry) => entry.id)).toEqual(['r1', 't1']);
  });

  test('the turn-framing context row splits the stretch; runtime guidance folds in as a step', () => {
    const items = chatTimeline(kinds, [user('u1', 'run-1'), context('c1'), tool('t1'), guidance('g1'), tool('t2')]);

    expect(items.map((item) => item.key)).toEqual(['u1', 'c1', 'activity:t1', 't1', 'g1', 't2']);
    expect(stretches(items)).toEqual(['activity:t1']);
    expect(stretch(items, 2).group.entries.map((entry) => entry.id)).toEqual(['t1', 'g1', 't2']);
  });

  test('the model speaking mid-run closes the segment; later work opens the next one', () => {
    const items = chatTimeline(kinds, [user('u1', 'run-1'), reasoning('r1'), assistant('a1'), tool('t1'), assistant('a2')]);

    expect(items.map((item) => item.key)).toEqual(['u1', 'r1', 'a1', 't1', 'a2']);
    expect(stretches(items)).toEqual(['activity:r1', 'activity:t1']);
  });

  test('words to the agent, from the operator or another agent, split the run at the position they were read', () => {
    const words = (id: string, sender: { name: string; threadId: string } | null): ChatEntry => ({
      id,
      kind: 'words',
      intent: sender === null ? 'user-message' : 'message',
      sender,
      text: id,
      runId: 'run-1',
    });
    const items = chatTimeline(kinds, [
      user('u1', 'run-1'),
      tool('t1'),
      words('steer', null),
      tool('t2'),
      words('peer', { name: 'peer', threadId: 'thread-peer' }),
      tool('t3'),
      assistant('a1'),
    ]);

    expect(items.map((item) => item.key)).toEqual(['u1', 't1', 'steer', 't2', 'peer', 't3', 'a1']);
    expect(stretches(items)).toEqual(['activity:t1', 'activity:t2', 'activity:t3']);
  });

  test('a plugin card and machinery signals take opposite sides of the fold', () => {
    const items = chatTimeline(kinds, [user('u1', 'run-1'), signal('sig-machine', 'transport'), tool('t1'), plugin('w1'), tool('t2')]);

    expect(stretches(items)).toEqual(['activity:sig-machine', 'activity:t2']);
    expect(stretch(items, 1).group.entries.map((entry) => entry.id)).toEqual(['sig-machine', 't1']);
  });

  test('a page landing above leaves every stretch below it keyed as it was', () => {
    const held = [user('u1', 'run-1'), tool('t1'), reasoning('r1'), assistant('a1'), tool('t2')];
    const before = chatTimeline(kinds, held);
    expect(stretches(before)).toContain('activity:t1');

    const older = [user('u0', 'run-1'), tool('t-old-1'), assistant('a0'), tool('t-old-2')];
    const after = chatTimeline(kinds, [...older, ...held]);

    for (const key of stretches(before)) expect(stretches(after)).toContain(key);
    expect(stretches(after)).toContain('activity:t-old-1');
  });

  test('stretch keys are stable while the stream appends to the tail', () => {
    const before = chatTimeline(kinds, [user('u1', 'run-1'), tool('t1'), assistant('a1'), reasoning('r2')]);
    const after = chatTimeline(kinds, [user('u1', 'run-1'), tool('t1'), assistant('a1'), reasoning('r2'), tool('t2'), assistant('a2')]);

    expect(stretches(before)).toEqual(['activity:t1', 'activity:r2']);
    expect(stretches(after)).toEqual(['activity:t1', 'activity:r2']);
  });

  test('two runs never fuse into one segment, and each stretch is named by its own first step', () => {
    const items = chatTimeline(kinds, [
      user('u1', 'run-1'),
      tool('t1'),
      assistant('a1'),
      signal('sig', 'transport', 'run-2'),
      reasoning('r2', 'run-2'),
      assistant('a2', 'run-2'),
    ]);

    expect(stretches(items)).toEqual(['activity:t1', 'activity:sig']);
  });

  test('run-less content entries and the system prompt pass through at their own position', () => {
    const items = chatTimeline(kinds, [systemPrompt('sys'), user('u1', 'run-1'), tool('t1'), user('u-local')]);

    expect(items.map((item) => item.key)).toEqual(['sys', 'u1', 't1', 'u-local']);
  });

  test('a run-less tool keeps the activity rail as its one detail owner', () => {
    const entry = tool('spoken-tool', { runId: undefined, toolState: 'output-error', toolError: 'boom' });
    const items = chatTimeline(kinds, [entry]);

    expect(items.map((item) => item.key)).toEqual(['spoken-tool']);
    expect(stretches(items)).toEqual(['activity:spoken-tool']);
  });

  test('notices read in a row outside a run stand as one row per kind, folded change by change as projected whole', () => {
    const notice = (id: string, told: NonNullable<Extract<ChatEntry, { kind: 'signal' }>['notice']>): ChatEntry => ({
      id,
      kind: 'signal',
      signalType: 'any-type',
      addressee: 'transport',
      text: 'notice',
      notice: told,
    });
    const child = (id: string, threadId: string): ChatEntry =>
      notice(id, {
        kind: 'child-update',
        child: { threadId, name: null },
        event: 'ran',
        forOperator: false,
        cost: { kind: 'unknown', tokens: null },
      });
    const call = (id: string): ChatEntry =>
      notice(id, { kind: 'call-ending', runId: 'run-1', toolCallId: id, tool: 'spawn_agent', outcome: 'completed', threads: [] });
    const head = [user('u1', 'run-1'), assistant('a1')];
    const steps: ChatEntry[][] = [
      head,
      [...head, child('c1', 'child-1')],
      [...head, child('c1', 'child-1'), child('c2', 'child-2'), child('c3', 'child-3')],
      [...head, child('c1', 'child-1'), child('c2', 'child-2'), child('c3', 'child-3'), call('k1'), call('k2')],
    ];
    const folded = chain();
    for (const entries of steps) expect(folded.show(entries)).toEqual(chain().show(entries));

    const rows = folded.show(steps[3]!).flatMap((item) => (item.kind === 'step' ? [item.row] : []));
    expect(rows.map((row) => [row.kind, row.kind === 'step' ? [row.entry.id] : row.entries.map((entry) => entry.id)])).toEqual([
      ['notices', ['c1', 'c2', 'c3']],
      ['notices', ['k1', 'k2']],
    ]);
  });

  test('a compaction of the run is a step of its stretch; a runless one stands at its own position', () => {
    const items = chatTimeline(kinds, [user('u1', 'run-1'), tool('t1'), compaction('c1'), tool('t2'), assistant('a1')]);

    expect(stretches(items)).toEqual(['activity:t1']);
    expect(stretch(items, 1).group.entries.map((entry) => entry.id)).toEqual(['t1', 'c1', 't2']);
    expect(items.map((item) => item.key)).toEqual(['u1', 'activity:t1', 't1', 'c1', 't2', 'a1']);

    const runless = chatTimeline(kinds, [compaction('c-local', null)]);
    expect(runless.map((item) => item.kind)).toEqual(['entry']);
  });

  test('the newest stretch keeps the title after the model speaks and after the run ends', () => {
    expect(newestOf([user('u1', 'run-1'), tool('t1'), tool('t2'), assistant('a1')])).toBe('activity:t1');
    expect(newestOf([user('u1', 'run-1'), tool('t1'), assistant('a1'), tool('t2'), assistant('a2')])).toBe('activity:t2');
  });

  test('a timeline with no machinery has no stretch to open', () => {
    expect(newestOf([user('u1', 'run-1'), assistant('a1')])).toBeNull();
  });

  test('under the all preference every stretch contributes its steps and its declared bodies', () => {
    const patch: ToolDisplay = {
      form: 'diff',
      title: 'agent.ts',
      files: [{ path: 'agent.ts', patch: '@@\n-a\n+b\n+c\n+d\n', added: 3, removed: 1 }],
      mutates: true,
    };
    const entries = [
      user('u1', 'run-1'),
      tool('t1', { display: patch }),
      tool('t2'),
      assistant('a1'),
      tool('t3', { display: patch }),
      tool('t4'),
    ];
    const newest = chatTimeline(kinds, entries, untouched('newest'));
    expect(newest.map((item) => item.key)).toEqual(['u1', 'activity:t1', 'a1', 'activity:t3', 't3', 't4']);

    const all = chatTimeline(kinds, entries, untouched('all'));
    expect(all.map((item) => item.key)).toEqual(['u1', 'activity:t1', 't1', 't2', 'a1', 'activity:t3', 't3', 't4']);
    const priced = (key: string) => all.find((item) => item.key === key)?.estimate;
    expect(priced('t1')).toBe(priced('t3'));
    expect(priced('t1')).toBeGreaterThan(priced('t2') ?? Number.POSITIVE_INFINITY);
  });

  test('a stretch is on screen through its line or any of its steps, never through a live row', () => {
    const fold = new TimelineFold(kinds);
    fold.load([user('u1', 'run-1'), tool('t1'), tool('t2'), assistant('a1'), tool('t3')], untouched('all'), {
      runId: 'run-1',
      entries: [tool('live-1', { toolState: 'input-available' }) as ActivityEntry],
      status: false,
    });
    const item = (key: string) => fold.item(key);

    expect(stretchOnScreen(item, 'activity:t1', ['activity:t1'])).toBe(true);
    expect(stretchOnScreen(item, 'activity:t1', ['t2'])).toBe(true);
    expect(stretchOnScreen(item, 'activity:t1', ['u1', 'a1'])).toBe(false);
    expect(stretchOnScreen(item, 'activity:t3', ['t3'])).toBe(true);
    expect(stretchOnScreen(item, 'activity:t3', ['live-1'])).toBe(false);
  });

  test('a stretch closed by hand under the all preference is its line alone', () => {
    const entries = [user('u1', 'run-1'), tool('t1'), tool('t2'), assistant('a1'), tool('t3'), tool('t4')];
    const hand: Record<string, boolean> = { 'activity:t1': false };
    const items = chatTimeline(kinds, entries, { ...untouched('all'), expanded: (key, fallback) => hand[key] ?? fallback });
    expect(items.map((item) => item.key)).toEqual(['u1', 'activity:t1', 'a1', 'activity:t3', 't3', 't4']);
  });

  test('the title crosses to a new run only when that run produces its first machinery', () => {
    const before = [
      user('u1', 'run-1', '2026-07-06T12:00:00.000Z'),
      tool('t1'),
      assistant('a1'),
      user('u2', 'run-2', '2026-07-08T12:00:00.000Z'),
      assistant('a2', 'run-2'),
    ];
    expect(newestOf(before)).toBe('activity:t1');

    const grown = [...before, { ...(tool('t2') as ChatEntry), runId: 'run-2' }];
    const after = chatTimeline(kinds, grown);
    expect(newestOf(grown)).toBe('activity:t2');
    expect(stretches(after)).toContain('activity:t1');
  });

  test('a question widget stands at its own position and closes the segment before it', () => {
    const items = chatTimeline(kinds, [
      user('u1', 'run-1'),
      tool('t1'),
      {
        id: 'q1',
        kind: 'question',
        runId: 'run-1',
        questionId: 'q1',
        toolCalls: [],
        prompts: [],
      },
      tool('t2'),
    ]);

    expect(items.map((item) => item.key)).toEqual(['u1', 't1', 'q1', 't2']);
    expect(stretches(items)).toEqual(['activity:t1', 'activity:t2']);
  });
});

describe('day separators', () => {
  test('the first row of a day carries the boundary, and nothing else does', () => {
    const items = chatTimeline(kinds, [
      user('u1', undefined, '2026-07-06T12:00:00.000Z'),
      user('u2', undefined, '2026-07-06T12:05:00.000Z'),
      user('u3', undefined, '2026-07-08T12:00:00.000Z'),
    ]);

    expect(items.map((item) => item.key)).toEqual(['u1', 'u2', 'u3']);
    expect(items.map((item) => item.dayBefore)).toEqual(['2026-07-06T12:00:00.000Z', undefined, '2026-07-08T12:00:00.000Z']);
  });

  test('undated entries carry no boundary', () => {
    const items = chatTimeline(kinds, [user('u1'), assistant('a1')]);
    expect(items.map((item) => item.dayBefore)).toEqual([undefined, undefined]);
  });

  test('a page landing above never leaves the same row at the head', () => {
    const held = [user('u9', undefined, '2026-07-06T12:30:00.000Z'), assistant('a9', 'run-9', '2026-07-06T12:31:00.000Z')];
    const older = [user('u1', undefined, '2026-07-06T09:00:00.000Z'), assistant('a1', 'run-1', '2026-07-06T09:01:00.000Z')];

    const before = chatTimeline(kinds, held);
    const after = chatTimeline(kinds, [...older, ...held]);

    expect(before[0]?.key).toBe('u9');
    expect(after[0]?.key).toBe('u1');
    expect(after.findIndex((item) => item.key === 'u9')).toBe(2);
  });

  test('a page landing above hands the boundary to the row that now opens the day', () => {
    const held = [user('u9', undefined, '2026-07-06T12:30:00.000Z')];
    const older = [user('u1', undefined, '2026-07-06T09:00:00.000Z')];

    const shown = chain();
    shown.show(held);
    const after = shown.show([...older, ...held]);

    expect(after.map((item) => (item.kind === 'tail' ? undefined : item.dayBefore))).toEqual(['2026-07-06T09:00:00.000Z', undefined]);
  });
});

describe('timeline identity across projections', () => {
  test('a timeline that moved in nothing is the previous one', () => {
    const entries = [user('u1'), assistant('a1'), tool('t1', { runId: 'run-1' })];
    const shown = chain();
    const first = shown.show(entries);
    const revision = shown.rows.revision;

    expect(shown.show(entries)).toEqual(first);
    expect(shown.rows.revision).toBe(revision);
  });

  test('an entry that changed takes a new item, and every other row keeps its own', () => {
    const entries = [user('u1'), assistant('a1'), tool('t1', { runId: 'run-1' })];
    const shown = chain();
    const first = shown.show(entries);
    const grown = entries.map((entry) => (entry.id === 'a1' ? { ...entry, text: 'answer, longer' } : entry));

    const next = shown.show(grown);

    expect(next.length).toBe(first.length);
    const changed = next.filter((item, index) => item !== first[index]);
    expect(changed.map((item) => item.key)).toEqual(['a1']);
  });

  test('a stretch that gained a step is a new item; the rows before it are not', () => {
    const entries = [user('u1'), tool('t1', { runId: 'run-1' })];
    const shown = chain();
    const first = shown.show(entries);

    const next = shown.show([...entries, tool('t2', { runId: 'run-1' })]);

    expect(next[0]).toBe(first[0]);
    expect(next.at(-1)).not.toBe(first.at(-1));
  });

  test('a tool that settles joins the stretch it belongs to, once, and the stretches around it keep their objects', () => {
    const run = { id: 'run-2', phase: 'working' as const };
    const earlier = [user('u1', 'run-1'), tool('t1', { runId: 'run-1' }), assistant('a1', 'run-1')];
    const running = (state: 'input-available' | 'output-available') => [
      ...earlier,
      user('u2', 'run-2'),
      tool('t2a', { runId: 'run-2' }),
      tool('t2b', { runId: 'run-2', toolState: state }),
      assistant('a2', 'run-2'),
    ];
    const shown = chain(run);
    const before = shown.show(running('input-available'), untouched('all'));
    expect(before.map((item) => item.key)).toEqual(['u1', 't1', 'a1', 'u2', 't2a', 'a2', 't2b', 'live:status']);

    const after = shown.show(running('output-available'), untouched('all'));

    expect(after.map((item) => item.key)).toEqual(['u1', 't1', 'a1', 'u2', 'activity:t2a', 't2a', 't2b', 'a2', 'live:status']);
    const standing = (items: readonly ChatTimelineItem[]) => items.slice(0, 4);
    for (const [index, item] of standing(after).entries()) expect(item).toBe(standing(before)[index]);
  });

  test('a tool whose kind keeps its view alive carries that while it runs and after it settles', () => {
    const own = builtinEntryKinds();
    own.registerTool('test', { name: 'live_view', keepAlive: true });
    const store = new ChatFold();
    const feed = new VisibleFeed(own);
    const rows = new TimelineFold(own);
    const run = { id: 'run-1', phase: 'working' as const };
    const view = untouched();
    const keepAlive = (state: 'input-available' | 'output-available') => {
      store.entries = [user('u1', 'run-1'), tool('t1', { toolName: 'live_view', toolState: state })];
      feed.sync(store, true, run);
      rows.sync(feed, view, { runId: run.id, status: true }, []);
      return rows.slice().find((item) => item.key === 't1')?.keepAlive;
    };

    expect(keepAlive('input-available')).toBe(true);
    expect(keepAlive('output-available')).toBe(true);
  });

  test('a tool call whose kind gives it a view stands as its own row, outside the stretch that folds its siblings', () => {
    const own = builtinEntryKinds();
    const view = (() => undefined) as unknown as ToolView;
    own.register('test', { kind: 'tool', view: (entry) => (entry.display?.app === undefined ? undefined : view) });
    const store = new ChatFold();
    const feed = new VisibleFeed(own);
    const rows = new TimelineFold(own);
    store.entries = [
      user('u1', 'run-1'),
      tool('t1a'),
      tool('t1b'),
      tool('t1v', { display: { form: 'none', app: { server: 'app', identity: 'declared', resource: 'ui://app/view' } } }),
      assistant('a1', 'run-1'),
      user('u2', 'run-2'),
      tool('t2a', { runId: 'run-2' }),
      tool('t2b', { runId: 'run-2' }),
    ];
    feed.sync(store, true, null);
    rows.sync(feed, untouched(), null, []);
    const items = rows.slice();
    expect(items.find((item) => item.key === 't1v')?.kind).toBe('entry');
    expect(items.some((item) => item.key === 't1a' || item.key === 't1b')).toBe(false);
  });

  test('the newest stretch keeps its object when another stretch is opened beside it', () => {
    const entries = [
      user('u1', 'run-1'),
      tool('t1a', { runId: 'run-1' }),
      tool('t1b', { runId: 'run-1' }),
      assistant('a1', 'run-1'),
      user('u2', 'run-2'),
      tool('t2a', { runId: 'run-2' }),
      tool('t2b', { runId: 'run-2' }),
    ];
    const shown = chain();
    const before = shown.show(
      entries,
      reader(() => false),
    );
    const after = shown.show(
      entries,
      reader((key) => key === 'activity:t1a'),
    );
    const newest = (items: readonly ChatTimelineItem[]) => items.filter((item) => item.kind === 'stretch' && item.key === 'activity:t2a');
    expect(newest(after)).toHaveLength(1);
    expect(newest(after)[0]).toBe(newest(before)[0]);
  });

  test('a timeline folded change by change equals the one projected whole', () => {
    const run = (index: number, day: string): ChatEntry[] => [
      user(`u${index}`, `run-${index}`, `2026-07-0${day}T09:00:00.000Z`),
      reasoning(`r${index}`, `run-${index}`),
      tool(`t${index}a`, { runId: `run-${index}` }),
      tool(`t${index}b`, { runId: `run-${index}` }),
      assistant(`a${index}`, `run-${index}`, `2026-07-0${day}T09:01:00.000Z`),
    ];
    const settled = [...run(1, '1'), ...run(2, '1'), ...run(3, '2')];
    const steps: ChatEntry[][] = [
      settled,
      [...settled, user('u4', 'run-4', '2026-07-03T09:00:00.000Z')],
      [...settled, user('u4', 'run-4', '2026-07-03T09:00:00.000Z'), tool('t4a', { runId: 'run-4', toolState: 'input-available' })],
      [...settled, user('u4', 'run-4', '2026-07-03T09:00:00.000Z'), tool('t4a', { runId: 'run-4' }), assistant('a4', 'run-4')],
      [
        ...settled,
        user('u4', 'run-4', '2026-07-03T09:00:00.000Z'),
        tool('t4a', { runId: 'run-4' }),
        { id: 'a4', kind: 'assistant', text: 'longer answer', runId: 'run-4' },
      ],
      [...settled, user('u4', 'run-4'), tool('t4a', { runId: 'run-4' }), assistant('a4', 'run-4'), tool('t4b', { runId: 'run-4' })],
      [...settled.slice(0, 5), { ...settled[5]!, rewound: { by: 'rw', scope: 'from' as const } }, ...settled.slice(6)],
      settled.slice(0, 9),
    ];
    for (const view of [untouched('newest'), untouched('all')]) {
      const folded = chain({ id: 'run-4', phase: 'working' });
      for (const entries of steps) {
        const whole = chain({ id: 'run-4', phase: 'working' });
        expect(folded.show(entries, view)).toEqual(whole.show(entries, view));
        expect(folded.rows.newestKey).toBe(whole.rows.newestKey);
      }
    }
  });
});

describe('which rows stand on a floor while their body parses', () => {
  test("the model's words stand on one; a stretch, a turn and a tail row never do", () => {
    const items = chatTimeline(kinds, [user('u1', 'run-1'), reasoning('r1'), tool('t1'), assistant('a1')]);
    const floored = items.filter((item) => timelineBodyArrivesLate(item)).map((item) => item.key);

    expect(floored).toEqual(['a1']);
    expect(timelineBodyArrivesLate(CHAT_TAIL_ITEMS.notice)).toBe(false);
  });

  test('an empty body waits for nothing', () => {
    const [item] = chatTimeline(kinds, [{ id: 'a1', kind: 'assistant', text: '', runId: 'run-1' }]);

    expect(item && timelineBodyArrivesLate(item)).toBe(false);
  });
});

describe('a run of machinery is rows, not one row', () => {
  const run = (steps: number) => [
    user('u1', 'run-1'),
    ...Array.from({ length: steps }, (_unused, index) => tool(`t${index}`, { toolName: `tool-${index}` })),
    assistant('a1'),
  ];

  test('an open stretch is one row per step; a closed one is its line alone', () => {
    const open = chatTimeline(
      kinds,
      run(300),
      reader(() => true),
    );
    const closed = chatTimeline(
      kinds,
      run(300),
      reader(() => false),
    );

    expect(open.filter((item) => item.kind === 'step')).toHaveLength(300);
    expect(closed.filter((item) => item.kind === 'step')).toHaveLength(0);
    expect(closed.map((item) => item.key)).toEqual(['u1', 'activity:t0', 'a1']);
  });

  test('the rows of a stretch carry their place in the column', () => {
    const items = chatTimeline(
      kinds,
      run(3),
      reader(() => true),
    );

    expect(items.flatMap((item) => (item.kind === 'step' ? [item.place] : []))).toEqual(['first', 'middle', 'last']);
  });

  test('opening a stretch leaves every row outside it the object it was', () => {
    const entries = [...run(3), user('u2', 'run-2'), tool('t-other', { runId: 'run-2' })];
    const shown = chain();
    const closed = shown.show(
      entries,
      reader((key) => key !== 'activity:t0'),
    );
    const opened = shown.show(
      entries,
      reader(() => true),
    );

    const outside = (items: readonly ChatTimelineItem[]) =>
      items.filter((item) =>
        item.kind === 'step' ? item.stretch !== 'activity:t0' : item.kind !== 'stretch' || item.key !== 'activity:t0',
      );
    expect(outside(opened).map((item) => item.key)).toEqual(outside(closed).map((item) => item.key));
    for (const [index, item] of outside(closed).entries()) expect(outside(opened)[index]).toBe(item);
  });
});

describe('rewound turns in the timeline', () => {
  const rewound = (entry: ChatEntry, by: string, scope: 'from' | 'turn'): ChatEntry => ({ ...entry, rewound: { by, scope } });
  const turn = (runId: string, by?: string, scope: 'from' | 'turn' = 'from'): ChatEntry[] =>
    [user(`u-${runId}`, runId), tool(`t-${runId}`, { runId }), assistant(`a-${runId}`, runId)].map((entry) =>
      by === undefined ? entry : rewound(entry, by, scope),
    );

  test('every rewound turn of one rewind collapses into one row at its first entry, counting its turns', () => {
    const entries = [...turn('run-1'), ...turn('run-2', 'rw'), ...turn('run-3', 'rw'), ...turn('run-4', 'rw')];

    const items = chatTimeline(kinds, entries);

    expect(items.map((item) => item.key)).toEqual(['u-run-1', 't-run-1', 'a-run-1', 'rewind:rw']);
    expect(items.at(-1)).toMatchObject({ kind: 'rewind', rewind: 'rw', scope: 'from', turns: 3, open: false });
  });

  test('a dropped turn stands as one line between the turns around it, naming its first words', () => {
    const entries = [...turn('run-1'), ...turn('run-2', 'drop', 'turn'), ...turn('run-3')];

    const items = chatTimeline(kinds, entries);

    expect(items.map((item) => item.key)).toEqual(['u-run-1', 't-run-1', 'a-run-1', 'rewind:drop', 'u-run-3', 't-run-3', 'a-run-3']);
    expect(items[3]).toMatchObject({ kind: 'rewind', scope: 'turn', turns: 1, words: 'question' });
  });

  test('an unmarked entry between rewound ones keeps its place after the one row its rewind stands as', () => {
    const entries = [...turn('run-1', 'rw'), signal('s1', 'reader', 'run-x'), ...turn('run-2', 'rw')];

    expect(chatTimeline(kinds, entries).map((item) => item.key)).toEqual(['rewind:rw', 's1']);
  });

  test('an opened rewind shows its turns under its row, folded as any turn is, and never as the newest stretch', () => {
    const entries = [...turn('run-1'), ...turn('run-2', 'rw')];

    const items = chatTimeline(
      kinds,
      entries,
      reader((key) => key === 'rewind:rw'),
    );

    expect(items.map((item) => item.key)).toEqual(['u-run-1', 't-run-1', 'a-run-1', 'rewind:rw', 'u-run-2', 't-run-2', 'a-run-2']);
    expect(items[3]).toMatchObject({ open: true });
    expect(
      newestOf(
        entries,
        reader((key) => key === 'rewind:rw'),
      ),
    ).toBe('activity:t-run-1');
  });

  test('rewinds folded change by change equal the timeline projected whole, with unrelated turns between their entries', () => {
    const mark = (entries: ChatEntry[], by: string): ChatEntry[] =>
      entries.map((entry) => ({ ...entry, rewound: { by, scope: 'from' as const } }));
    const unmarked = (entries: ChatEntry[]): ChatEntry[] => entries.map(({ rewound: _rewound, ...entry }) => entry as ChatEntry);
    const base = [...turn('run-1'), ...turn('run-2', 'rw'), ...turn('run-3'), ...turn('run-4', 'rw'), ...turn('run-5')];
    const grown = base.map((entry) => (entry.id === 'a-run-2' ? ({ ...entry, text: 'answer, longer' } as ChatEntry) : entry));
    const steps: ChatEntry[][] = [
      base,
      grown,
      [...grown, ...turn('run-6')],
      [...grown.filter((entry) => entry.runId !== 'run-2'), ...turn('run-6')],
      [...turn('run-0'), ...grown.filter((entry) => entry.runId !== 'run-2'), ...turn('run-6')],
      [
        ...turn('run-0'),
        ...turn('run-1'),
        ...turn('run-2', 'rw'),
        ...unmarked(turn('run-3')),
        ...unmarked(turn('run-4')),
        ...turn('run-5'),
      ],
      [...turn('run-1'), ...mark(turn('run-2'), 'rv'), ...turn('run-3'), ...mark(turn('run-4'), 'rv'), ...mark(turn('run-5'), 'rw')],
      [...turn('run-1'), ...mark(turn('run-2'), 'rv'), ...mark(turn('run-5'), 'rw')],
    ];
    for (const view of [untouched('newest'), reader((key) => key === 'rewind:rv')]) {
      const shown = chain();
      for (const entries of steps) expect(shown.show(entries, view)).toEqual(chain().show(entries, view));
    }
  });
});

describe('a streaming run draws its parts in the order they arrived', () => {
  test('a finished thought stays above the answer streaming after it, before and after its record lands', () => {
    const fold = new ChatFold();
    const reader = new FeedReader<TestThread>(fold);
    const feed = new VisibleFeed(kinds);
    const rows = new TimelineFold(kinds);
    const run: FeedRun = { id: 'run-1', phase: 'writing' };
    const thought = (state: 'streaming' | 'done') => ({
      type: 'reasoning',
      id: 'reasoning:run-1',
      runId: 'run-1',
      text: 'Weighing it.',
      state,
    });
    const answer = { type: 'message', id: 'assistant:run-1', role: 'assistant', runId: 'run-1', text: 'Раз' };
    let seq = 1;
    const read = (event: ChatFeedEvent<TestThread>) => {
      expect(reader.read(event).kind).toBe('applied');
      feed.sync(fold, false, run);
      rows.sync(feed, untouched(), { runId: run.id, status: true }, []);
      return rows.slice().flatMap((item) => (item.kind === 'entry' || item.kind === 'step' ? [item.key] : []));
    };
    const open = (change: ThreadOpenChange) => read(openEvent(change, at(1, ++seq)));

    read(
      snapshotEvent({
        position: 1,
        activeRunId: 'run-1',
        transcript: [{ type: 'message', id: 'message:user:run-1', role: 'user', runId: 'run-1', text: 'начни' }],
      }),
    );
    open({ op: 'put', entry: thought('streaming') as never });
    open({ op: 'put', entry: thought('done') as never });
    const order = ['message:user:run-1', 'reasoning:run-1', 'assistant:run-1'];

    expect(open({ op: 'put', entry: answer as never })).toEqual(order);
    expect(
      read(stateEvent({ activeRunId: 'run-1' }, at(2, ++seq), [{ position: 2, kind: 'reasoning', entry: thought('done') as never }])),
    ).toEqual(order);
    expect(open({ op: 'append', id: 'assistant:run-1', text: ' два' })).toEqual(order);
  });
});
