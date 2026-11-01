// @vitest-environment jsdom

import type { CallEvent, CallRecord } from '@runlith/agent/callProgress';
import { Scope } from '@runlith/layer/Scope';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import type { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import type { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { CallActivity } from './CallActivity.svelte.js';
import type { ThreadTreeNode } from './forest.js';
import { RowReading } from './rowReading.svelte.js';
import type { WorkInput } from './workLine.js';
import type { WorkLines } from './workLines.svelte.js';

const waiting = (toolCallId: string): CallRecord =>
  ({
    runId: 'run-1',
    toolCallId,
    threadId: 'thread-1',
    name: 'bash',
    input: {},
    phase: 'waiting',
    mode: 'background',
    detachable: false,
    startedAt: 1,
    admittedAt: null,
    endedAt: null,
    expiresAt: null,
    expiresBy: null,
    limitCeilingMs: null,
    detail: null,
    executions: [],
  }) as CallRecord;

const row = (over: Partial<ThreadListRow>): ThreadListRow =>
  ({ id: 'thread-1', life: 'idle', outcome: null, parentThreadId: null, phase: null, owes: false, ...over }) as ThreadListRow;

let leave: (() => void) | undefined;

afterEach(() => {
  leave?.();
  leave = undefined;
});

function reading(thread: ThreadListRow, held: readonly string[]) {
  const followed: (WorkInput | null)[] = [];
  let calls!: CallActivity;
  let send!: (frame: CallEvent) => void;
  const live = {
    hold: (_open: unknown, frame: (value: CallEvent) => void) => {
      send = frame;
      return { unsubscribe: () => undefined };
    },
  } as unknown as LiveConnection;
  let read!: RowReading;
  leave = $effect.root(() => {
    calls = new CallActivity({ projectId: 1 }, live, {} as Door, Scope.make('row-reading-test'));
    const clock = { now: 0, minuteNow: 0, watch: () => () => undefined, watchMinutes: () => () => undefined };
    const lines = { follow: (_id: string, input: WorkInput | null) => followed.push(input), release: () => undefined, shown: () => null };
    const node = {
      row: thread,
      children: [],
      team: { working: 0, workers: [] },
      lastEventAt: thread.readerOrderAt,
    } as unknown as ThreadTreeNode;
    read = new RowReading(() => node, clock as unknown as WallClock, lines as unknown as WorkLines, {} as ProviderCatalog, calls);
  });
  send({ type: 'snapshot', calls: held.map(waiting) });
  flushSync();
  return { read, followed };
}

test('background calls waiting their turn are told on a row whose turn has ended, and on none that has none', () => {
  expect(reading(row({ owes: true }), ['call-1', 'call-2']).read.own?.text).toBe('2 queued');
  expect(reading(row({ owes: true }), []).read.own).toBeNull();
  expect(reading(row({}), ['call-1']).read.own?.text).toBe('1 queued');
});

test('a working row hands the work line each waiting call once, whether its phase queues it or already runs it', () => {
  const phase = (queued: readonly string[], ids: readonly string[]): ThreadListRow['phase'] => ({
    phase: 'tools',
    since: null,
    calls: ids.map((id) => ({ id, name: 'bash', title: null, since: null })),
    queued,
  });
  const working = (queued: readonly string[], ids: readonly string[]) => row({ life: 'working', phase: phase(queued, ids) });
  const queuedOf = (thread: ThreadListRow, held: readonly string[]) => reading(thread, held).followed.at(-1)?.queued;

  expect(queuedOf(working(['call-1'], []), ['call-1'])).toBe(1);
  expect(queuedOf(working(['call-1'], []), ['call-1', 'call-2'])).toBe(2);
  expect(queuedOf(working([], ['call-1']), ['call-1'])).toBe(0);
});
