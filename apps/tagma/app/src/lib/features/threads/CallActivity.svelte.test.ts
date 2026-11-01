import type { CallEvent, CallRecord } from '@runlith/agent/callProgress';
import { Scope } from '@runlith/layer/Scope';
import { expect, test } from 'vitest';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { CallActivity } from './CallActivity.svelte.js';

const WINDOW = 200;

const call = (thread: string, id: string, over: Partial<CallRecord> = {}): CallRecord =>
  ({
    runId: `run-${thread}`,
    toolCallId: id,
    threadId: thread,
    name: 'bash',
    input: {},
    phase: 'running',
    mode: 'foreground',
    detachable: false,
    startedAt: 1_000,
    admittedAt: 1_000,
    endedAt: null,
    expiresAt: null,
    expiresBy: null,
    limitCeilingMs: null,
    detail: null,
    executions: [],
    ...over,
  }) as CallRecord;

const ended = (thread: string, id: string, at: number): CallRecord =>
  call(thread, id, { phase: 'completed', startedAt: at - 10, endedAt: at });

function activity() {
  let deliver: ((frame: CallEvent) => void) | null = null;
  const live = {
    hold: (_open: unknown, frame: (value: CallEvent) => void) => {
      deliver = frame;
      return { unsubscribe: () => undefined };
    },
  } as unknown as LiveConnection;
  const door = { ask: async () => ({ status: 'changed', detail: null }) } as unknown as Door;
  const calls = new CallActivity({ projectId: 1 }, live, door, Scope.make('call-activity-test'));
  return { calls, send: (frame: CallEvent) => deliver?.(frame) };
}

test('a call that moves changes its own thread’s calls, and every other thread keeps the slice its row holds', () => {
  const { calls, send } = activity();
  send({ type: 'snapshot', calls: [call('a', 'a-1'), ended('a', 'a-0', 5_000), call('b', 'b-1'), ended('b', 'b-0', 4_000)] });
  const before = { a: calls.callsOf('a'), b: calls.callsOf('b') };
  expect(before.a.map((held) => held.toolCallId)).toEqual(['a-1', 'a-0']);

  send({ type: 'updated', call: ended('a', 'a-1', 6_000) });
  expect(calls.callsOf('b')).toBe(before.b);
  expect(calls.callsOf('a').map((held) => [held.toolCallId, held.endedAt])).toEqual([
    ['a-1', 6_000],
    ['a-0', 5_000],
  ]);
  expect(calls.callAt('a', 'run-a', 'a-1')).toBeNull();
  expect(calls.callAt('b', 'run-b', 'b-1')?.toolCallId).toBe('b-1');

  send({ type: 'updated', call: call('c', 'c-1') });
  expect(calls.callsOf('b')).toBe(before.b);
  expect(calls.callsOf('c').map((held) => held.toolCallId)).toEqual(['c-1']);

  send({
    type: 'snapshot',
    calls: structuredClone([...calls.callsOf('a'), ...calls.callsOf('b'), call('c', 'c-1', { phase: 'stopping' })]),
  });
  expect(calls.callsOf('b')).toBe(before.b);
  expect(calls.callsOf('c').map((held) => held.phase)).toEqual(['stopping']);
});

test('only a background call still waiting its turn counts as waiting work of its thread', () => {
  const { calls, send } = activity();
  const waiting = (id: string, over: Partial<CallRecord> = {}) =>
    call('a', id, { mode: 'background', phase: 'waiting', admittedAt: null, ...over });
  send({
    type: 'snapshot',
    calls: [
      waiting('w-1'),
      waiting('w-2', { phase: 'preparing' }),
      waiting('w-3', { phase: 'running', admittedAt: 1_000 }),
      waiting('w-4', { phase: 'completed', endedAt: 2_000 }),
      call('a', 'f-1', { phase: 'waiting', admittedAt: null }),
      waiting('o-1', { threadId: 'b' }),
    ],
  });
  expect(calls.waitingOf('a', null)).toBe(2);
  expect(calls.waitingOf('c', null)).toBe(0);
});

test('a waiting call the thread’s phase already stands is not waiting work again, whichever list the phase keeps it in', () => {
  const { calls, send } = activity();
  const waiting = (id: string) => call('a', id, { mode: 'background', phase: 'waiting', admittedAt: null });
  send({ type: 'snapshot', calls: [waiting('w-1'), waiting('w-2'), waiting('w-3')] });
  const phase = {
    phase: 'tools',
    since: null,
    calls: [{ id: 'w-1', name: 'bash', title: null, since: null }],
    queued: ['w-2'],
  } as const;
  expect(calls.waitingOf('a', phase)).toBe(1);
});

test('the window keeps every standing call and the newest endings, and what a pruned call was told is forgotten with it', async () => {
  const { calls, send } = activity();
  const history = Array.from({ length: WINDOW }, (_unused, at) => ended(at === 0 ? 'old' : 'busy', `h-${at}`, 10_000 + at));
  send({ type: 'snapshot', calls: [call('old', 'standing'), ...history] });
  const oldest = calls.callsOf('old').find((held) => held.toolCallId === 'h-0');
  if (oldest === undefined) throw new Error('The oldest ending was not held.');
  await calls.control(oldest, { action: 'stop' });
  expect(calls.saidOf(oldest)).not.toBeNull();

  send({ type: 'updated', call: ended('new', 'n-1', 20_000) });

  expect(calls.callsOf('old').map((held) => held.toolCallId)).toEqual(['standing']);
  expect(calls.callsOf('new').map((held) => held.toolCallId)).toEqual(['n-1']);
  expect(calls.callsOf('busy')).toHaveLength(WINDOW - 1);
  expect(calls.saidOf(oldest)).toBeNull();

  send({ type: 'updated', call: ended('late', 'l-1', 1) });
  expect(calls.callsOf('late')).toEqual([]);
  expect(calls.callsOf('busy')).toHaveLength(WINDOW - 1);
});
