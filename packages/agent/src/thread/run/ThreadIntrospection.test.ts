import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { ThreadIntrospection, threadIntrospectionLayer } from './ThreadIntrospection';
import { ThreadEventJournal, ThreadStore } from '../ThreadPorts';
import { ThreadEntryKinds } from '../../transcript/kinds';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadStorageFailed } from '../persisted';
import type { ThreadEventRevision, ThreadRecordWindow } from '../storage/eventLog';
import { makeAggregateStorage } from '../storage/InMemoryAggregateStorage';
const threadId = 'thread-1';
const occurredAt = '2026-09-18T00:00:00.000Z';
const rows: readonly ThreadEventRevision[] = [
  event(1, 'entry-1', 'first'),
  {
    ...event(2, 'entry-2', 'unreadable'),
    payload: {
      entry: { type: 'message', id: 'entry-2', role: 'user', text: 'unreadable', occurredAt },
      messages: [{ role: 'user', content: 42 }],
    },
  },
  event(3, 'entry-3', 'third'),
];
describe('ThreadIntrospection over unreadable stored evidence', () => {
  it.effect(
    'a population continues around the row and names the thread, position and family',
    Effect.fnUntraced(function* () {
      const introspection = yield* ThreadIntrospection;
      const answer = yield* introspection.query({
        query: { select: 'entries', where: [{ field: 'threadId', op: 'exists', value: true }] },
        targets: [{ threadId, head: 3, runs: [] }],
      });
      expect(answer.rows.map((row) => row.at)).toEqual([1, 3]);
      expect({ ...answer.coverage, unavailable: answer.coverage.unavailable.map((line) => line.split(' — ')[0]) }).toEqual({
        complete: true,
        unavailable: ['threadId=thread-1 at=2 family=messages'],
        truncated: false,
        read: 2,
      });
    }, Effect.provide(layer)),
  );
  it.effect(
    'one addressed record still refuses at the persistence boundary',
    Effect.fnUntraced(function* () {
      const introspection = yield* ThreadIntrospection;
      const failure = yield* Effect.flip(introspection.entryAt(threadId, 2));
      expect(failure).toBeInstanceOf(ThreadStorageFailed);
      if (!(failure instanceof ThreadStorageFailed)) return yield* Effect.die('Expected a persistence refusal');
      expect(failure.call).toBe('eventsAfter');
      expect(failure.message).toContain('["messages"][0]["content"]');
    }, Effect.provide(layer)),
  );
});
function event(position: number, identity: string, text: string): ThreadEventRevision {
  return {
    threadId,
    position,
    id: `event-${position}`,
    kind: 'message',
    identity,
    payload: {
      entry: { type: 'message', id: identity, role: 'user', text, occurredAt },
    },
  };
}
function windowed(window: ThreadRecordWindow): readonly ThreadEventRevision[] {
  return rows
    .filter(
      (row) =>
        row.position > window.afterPosition &&
        row.position <= window.head &&
        (window.kinds === undefined || window.kinds.includes(row.kind)),
    )
    .slice(0, window.limit);
}
const unused = () => Effect.die('The evidence query does not use this operation');
const journal = ThreadEventJournal.of({
  append: unused,
  recordsAsOf: (_threadId, window) => Effect.sync(() => windowed(window)),
  revisionsAsOf: (_threadId, window) => Effect.sync(() => windowed(window)),
  eventsAfter: (_threadId, afterPosition, limit) => Effect.sync(() => rows.filter((row) => row.position > afterPosition).slice(0, limit)),
  headPosition: unused,
  positionOf: unused,
});
const layer = threadIntrospectionLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(ThreadEventJournal, journal),
      Layer.succeed(
        ThreadRunLedger,
        ThreadRunLedger.of({
          runById: unused,
          isRunning: unused,
          runningHere: unused,
          activeRun: unused,
          activeRunIn: unused,
          runningOf: unused,
          latestRun: unused,
          runsOf: unused,
          latestRuns: unused,
          reapable: unused,
        }),
      ),
      Layer.succeed(ThreadStore, makeAggregateStorage()),
      ThreadEntryKinds.layer([]),
    ),
  ),
);
