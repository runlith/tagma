import type { ThreadEventDelta } from '@runlith/agent/transcript/eventFold';
import type { ThreadOpenChange } from '@runlith/agent/transcript/live';
import { FeedView } from '@runlith/agent/transcript/testing/feedView';
import { describe, expect, test } from 'vitest';
import { ChatFold } from './ChatFold.svelte';
import { FeedReader } from './session/FeedReader';
import { at, type SnapshotInput, snapshotEvent, state, stateEvent } from './testing/chatHarness.svelte';
import type { ChatFeedEvent } from './wire/ChatConnection';
import type { TestThread } from './testing/chatConnection';

type Raw = Record<string, unknown> & { readonly id: string; readonly type: string };

const message = (id: string, role: 'user' | 'assistant', runId: string, text: string): Raw => ({ type: 'message', id, role, runId, text });
const tool = (callId: string, toolState: string, extra: Record<string, unknown> = {}): Raw => ({
  type: 'tool',
  id: `tool:${callId}`,
  runId: 'run-1',
  toolName: 'bash',
  toolCallId: callId,
  toolState,
  ...extra,
});
const runEnd = (status: string): Raw => ({
  type: 'run-end',
  id: 'run-end:run-1',
  runId: 'run-1',
  status,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
  occurredAt: '2026-01-01T00:01:00.000Z',
});
const record = (position: number, entry: Raw): ThreadEventDelta => ({ position, kind: entry.type, entry: entry as never });

const snap = (seq: number, position: number, input: SnapshotInput): ChatFeedEvent<TestThread> => snapshotEvent({ ...input, position, seq });
const frame = (seq: number, position: number, records: readonly ThreadEventDelta[]) =>
  stateEvent({ activeRunId: 'run-1' }, at(position, seq), records);
const open = (seq: number, change: ThreadOpenChange): ChatFeedEvent<TestThread> => ({ type: 'open', at: at(1, seq), change });

const user = message('message:user:run-1', 'user', 'run-1', 'начни');

const corpus: Record<string, readonly ChatFeedEvent<TestThread>[]> = {
  'tools that settle out of order, a streaming answer that settles under its record, and the run end': [
    snap(1, 1, { activeRunId: 'run-1', transcript: [user] }),
    open(2, { op: 'put', entry: tool('a', 'input-available'), from: 0 }),
    open(3, { op: 'put', entry: tool('b', 'input-available'), from: 0 }),
    open(4, { op: 'put', entry: message('assistant:run-1', 'assistant', 'run-1', 'Раз'), from: 0 }),
    open(5, { op: 'append', id: 'assistant:run-1', text: ' два' }),
    frame(6, 2, [record(2, tool('b', 'output-available'))]),
    frame(7, 3, [record(3, tool('a', 'output-error'))]),
    frame(8, 5, [record(4, message('assistant:run-1', 'assistant', 'run-1', 'Раз два')), record(5, runEnd('completed'))]),
  ],
};

function shown(fold: ChatFold) {
  return fold.entries.map((entry) => ({ ...entry }));
}

describe('a session fed by events equals a session fed the snapshot the producer reads at the same position', () => {
  test.each(Object.keys(corpus))('%s', (name) => {
    const events = corpus[name]!;
    const oracle = new FeedView<unknown>();
    const folded = new ChatFold();
    const reader = new FeedReader(folded);

    for (const event of events) {
      expect(oracle.take(event as never)).toBe(true);
      expect(reader.read(event).kind).toBe('applied');

      const fresh = new ChatFold();
      new FeedReader(fresh).read(
        snapshotEvent({
          position: oracle.at!.position,
          seq: oracle.at!.seq,
          activeRunId: 'run-1',
          transcript: oracle.transcript as never,
          open: oracle.open.map((one) => one.entry) as never,
        }),
      );
      expect(shown(folded)).toEqual(shown(fresh));
    }
  });
});
