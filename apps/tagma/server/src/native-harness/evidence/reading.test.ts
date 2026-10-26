import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ActivityRecord } from '@runlith/activity/store/record';
import { RECORDS_PER_QUERY, ThreadIntrospection, threadIntrospectionLayer } from '@runlith/agent/thread/ThreadIntrospection';
import { ThreadEventJournal, ThreadStore } from '@runlith/agent/thread/ThreadPorts';
import { ThreadRunLedger } from '@runlith/agent/thread/run/ThreadRunLedger';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { ThreadEventRevision, ThreadRecordWindow } from '@runlith/agent/thread/storage/eventLog';
import { EvidenceReads } from '../../threads/contract/service/evidence.js';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { ThreadWindows } from '../../threads/contract/service/reads.js';
import { ThreadList } from '../../threads/contract/service/list.js';
import type { ThreadRunStore } from '../runs/ledger.js';
import { evidenceReading } from './reading.js';
import { evidenceReads } from './retained.js';

const threadId = 'thread-wide';
const head = RECORDS_PER_QUERY + 1;
const unread = () => Effect.die('the reading never reaches this');

const windowed = (window: ThreadRecordWindow): readonly ThreadEventRevision[] => {
  const made: ThreadEventRevision[] = [];
  for (let position = window.afterPosition + 1; position <= Math.min(window.head, window.afterPosition + window.limit); position += 1)
    made.push({
      threadId,
      position,
      id: `event-${position}`,
      kind: 'message',
      identity: `entry-${position}`,
      payload: { entry: { type: 'message', id: `entry-${position}`, role: 'user', text: 'row', occurredAt: '2026-10-15T00:00:00.000Z' } },
    });
  return made;
};

const kernel = threadIntrospectionLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(
        ThreadEventJournal,
        ThreadEventJournal.of({
          append: unread,
          recordsAsOf: (_thread, window) => Effect.sync(() => windowed(window)),
          revisionsAsOf: (_thread, window) => Effect.sync(() => windowed(window)),
          eventsAfter: unread,
          headPosition: unread,
          positionOf: unread,
        }),
      ),
      Layer.succeed(ThreadRunLedger, {} as ThreadRunLedger['Service']),
      Layer.succeed(ThreadStore, {} as ThreadStore['Service']),
      ThreadEntryKinds.layer([]),
    ),
  ),
);

const queries = Effect.gen(function* () {
  const introspection = yield* ThreadIntrospection;
  const reads = yield* evidenceReads('/unwritten');
  const harness = { reads: { pin: () => Effect.succeed({ threadId, head, runs: [] }), query: introspection.query } };
  return yield* evidenceReading({
    runs: {} as ThreadRunStore,
    gate: {
      opened: (_thread, _project, work) => work(),
      resolveRecord: (_thread, record) => Effect.succeed(record),
      retainedSlice: unread,
    },
  }).pipe(
    Effect.provideContext(
      Context.make(ThreadHarness, harness as unknown as ThreadHarness['Service']).pipe(
        Context.add(ThreadWindows, {} as ThreadWindows['Service']),
        Context.add(EvidenceReads, reads),
        Context.add(ThreadList, {} as ThreadList['Service']),
        Context.add(ActivityRecord, {} as ActivityRecord['Service']),
      ),
    ),
  );
}).pipe(Effect.provide(Layer.merge(kernel, FileSystem.layerNoop({}))));

it.effect('an aggregate cut by the read ceiling continues from its cursor with its totals until it covers the whole population', () =>
  Effect.gen(function* () {
    const reading = yield* queries;
    const query = { select: 'entries', where: [{ field: 'threadId', op: 'exists', value: true }], count: true } as const;
    const operator = { kind: 'operator' } as const;
    const first = yield* reading.query(operator, 1, { query, threads: [threadId] });
    expect([first.coverage.cut, first.groups?.[0]?.count]).toEqual(['read-ceiling', RECORDS_PER_QUERY]);
    const cursor = first.cursor;
    expect(cursor).not.toBeNull();
    const rest = yield* reading.query(operator, 1, { query, threads: [threadId], cursor: cursor! });
    expect([rest.coverage.complete, rest.groups?.[0]?.count, rest.cursor]).toEqual([true, head, null]);
    const replayed = yield* Effect.flip(reading.query(operator, 1, { query, threads: [threadId], cursor: cursor! }));
    expect(replayed).toMatchObject({ code: 'cursor-stale' });
  }),
);
