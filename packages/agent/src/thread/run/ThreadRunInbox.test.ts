import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, Layer } from 'effect';
import type { ThreadSignal } from '../../transcript/parts';
import type { ThreadInboxItemValues } from '../storage/inbox';
import { makeAggregateStorage, type InMemoryAggregateStorage } from '../storage/InMemoryAggregateStorage';
import { inboxSignalValues } from '../inboxItems';
import { ThreadOwner, ThreadInbox, ThreadStore, ThreadEventJournal, ThreadTransitions } from '../ThreadPorts';
import { threadCauseOf } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import { threadChangesLayer } from './ThreadChanges';
import { threadRunInboxLayer, ThreadRunInbox } from './ThreadRunInbox';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadEntryKinds } from '../../transcript/kinds';
import { runRow } from '../conformance/runCycle/runDoubles';
import { inboxFixture } from '../conformance/runCycle/inbox';
import { recordingJournal } from '../conformance/runCycle/eventLog';
it.effect(
  'signals drain in acceptance order even when an earlier reservation commits later',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    const queue = window.signalQueue(runRef.id);
    const gate = yield* storage.hold('first');
    const first = yield* Effect.forkScoped(window.enqueue(runRef, item(signal('first'))));
    yield* Deferred.await(gate.entered);
    expect(yield* window.enqueue(runRef, item(signal('second')))).toBe('delivered');
    expect(queue.drain()).toEqual([signal('second')]);
    yield* Deferred.succeed(gate.release, undefined);
    expect(yield* Fiber.join(first)).toBe('delivered');
    expect(queue.drain()).toEqual([signal('first')]);
    expect((yield* storage.inbox.pending(runRef.threadId)).map((entry) => entry.id)).toEqual(['second', 'first']);
  }),
);
it.effect(
  'remote signals persist queued and a local queue receives later signals once',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    expect(yield* window.enqueue(runRef, item(signal('remote')))).toBe('queued');
    expect(yield* storage.inbox.receipt('remote')).toMatchObject({ state: 'queued', deliveredToRunId: null });
    const queue = window.signalQueue(runRef.id);
    expect(yield* window.enqueue(runRef, item(signal('local')))).toBe('delivered');
    expect(queue.drain()).toEqual([signal('local')]);
    expect(queue.drain()).toEqual([]);
    expect(yield* window.read(runRef)).toEqual([signal('remote')]);
    expect(yield* window.read(runRef)).toEqual([]);
  }),
);
it.effect(
  'a reserved signal is pending but unreadable until acceptance and remains unread until drained',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    const queue = window.signalQueue(runRef.id);
    const told: ThreadSignal[] = [];
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        queue.subscribe((arrived) => {
          told.push(arrived);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const gate = yield* storage.hold('signal-1');
    const enqueue = yield* Effect.forkScoped(window.enqueue(runRef, item(signal('signal-1'))));
    yield* Deferred.await(gate.entered);
    expect(queue.hasPending()).toBe(true);
    expect(queue.hasReadable()).toBe(false);
    expect(queue.drain()).toEqual([]);
    expect(queue.unread()).toEqual([]);
    expect(told).toEqual([]);
    yield* Deferred.succeed(gate.release, undefined);
    expect(yield* Fiber.join(enqueue)).toBe('delivered');
    expect(queue.hasPending()).toBe(true);
    expect(queue.hasReadable()).toBe(true);
    expect(told).toEqual([signal('signal-1')]);
    expect(queue.unread()).toEqual([signal('signal-1')]);
    expect(queue.drain()).toEqual([signal('signal-1')]);
    expect(queue.hasPending()).toBe(false);
    expect(queue.unread()).toEqual([]);
  }),
);
it.effect(
  'failed acceptance removes its reservation and does not block a later signal',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    const queue = window.signalQueue(runRef.id);
    const failure = new Error('database unavailable');
    storage.faults.put = failure;
    expect(threadCauseOf(yield* Effect.flip(window.enqueue(runRef, item(signal('lost')))))).toBe(failure);
    expect(queue.hasPending()).toBe(false);
    expect(yield* storage.inbox.receipt('lost')).toBeUndefined();
    storage.faults.put = null;
    expect(yield* window.enqueue(runRef, item(signal('next')))).toBe('delivered');
    expect(queue.drain()).toEqual([signal('next')]);
  }),
);
it.effect(
  'a failing accepted participant rolls back its durable input and reservation',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    const queue = window.signalQueue(runRef.id);
    const failure = new ThreadStorageFailed({ call: 'accepted', cause: new Error('participant failed') });
    expect(yield* Effect.flip(window.enqueue(runRef, item(signal('lost')), undefined, () => Effect.fail(failure)))).toBe(failure);
    expect(yield* storage.inbox.receipt('lost')).toBeUndefined();
    expect(queue.hasPending()).toBe(false);
  }),
);
it.effect(
  'duplicate and concurrent handers occupy one place and cannot redeliver a read item',
  Effect.fnUntraced(function* () {
    const { window } = yield* inboxWorld();
    const queue = window.signalQueue(runRef.id);
    const words = item(signal('same'));
    expect(yield* Effect.all([window.enqueue(runRef, words), window.enqueue(runRef, words)], { concurrency: 2 })).toEqual([
      'delivered',
      'delivered',
    ]);
    expect(yield* window.enqueue(runRef, words)).toBe('delivered');
    expect(queue.drain()).toEqual([signal('same')]);
    expect(queue.hasPending()).toBe(false);
    expect(yield* window.enqueue(runRef, words)).toBe('already-read');
    expect(queue.drain()).toEqual([]);
    expect(queue.hasPending()).toBe(false);
  }),
);
it.effect(
  'an input boundary waits for its cohort without waiting for a later blocked reservation',
  Effect.fnUntraced(function* () {
    const storage = inboxFixture();
    const snapshot = yield* Deferred.make<void>();
    const continueRead = yield* Deferred.make<void>();
    const pending = storage.inbox.pending;
    let capture = true;
    storage.inbox.pending = Effect.fnUntraced(function* (id, tx) {
      const rows = yield* pending(id, tx);
      if (capture) {
        capture = false;
        yield* Deferred.succeed(snapshot, undefined);
        yield* Deferred.await(continueRead);
      }
      return rows;
    });
    const { window } = yield* inboxWorld({ storage });
    window.signalQueue(runRef.id);
    const firstGate = yield* storage.hold('first');
    const first = yield* Effect.forkScoped(window.enqueue(runRef, item(signal('first'))));
    yield* Deferred.await(firstGate.entered);
    const reading = yield* Effect.forkScoped(window.read(runRef));
    yield* Deferred.await(snapshot);
    const laterGate = yield* storage.hold('later');
    const later = yield* Effect.forkScoped(window.enqueue(runRef, item(signal('later'))));
    yield* Deferred.await(laterGate.entered);
    yield* Deferred.succeed(continueRead, undefined);
    yield* Deferred.succeed(firstGate.release, undefined);
    expect(yield* Fiber.join(first)).toBe('delivered');
    expect((yield* Fiber.join(reading)).map((word) => word.id)).toEqual(['first']);
    expect(yield* window.hasPending(runRef)).toBe(true);
    yield* Deferred.succeed(laterGate.release, undefined);
    yield* Fiber.join(later);
    expect((yield* window.read(runRef)).map((word) => word.id)).toEqual(['later']);
  }),
);
it.effect(
  'a read that waited for its cohort returns acceptance order rather than reservation order',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    window.signalQueue(runRef.id);
    const firstGate = yield* storage.hold('reserved-first');
    const first = yield* Effect.forkScoped(window.enqueue(runRef, item(signal('reserved-first'))));
    yield* Deferred.await(firstGate.entered);
    const secondGate = yield* storage.hold('accepted-first');
    const second = yield* Effect.forkScoped(window.enqueue(runRef, item(signal('accepted-first'))));
    yield* Deferred.await(secondGate.entered);
    const snapshot = yield* Deferred.make<void>();
    const pending = storage.inbox.pending;
    storage.inbox.pending = (id, tx) => pending(id, tx).pipe(Effect.tap(() => Deferred.succeed(snapshot, undefined)));
    const reading = yield* Effect.forkScoped(window.read(runRef));
    yield* Deferred.await(snapshot);
    yield* Deferred.succeed(secondGate.release, undefined);
    yield* Fiber.join(second);
    yield* Deferred.succeed(firstGate.release, undefined);
    yield* Fiber.join(first);
    expect((yield* Fiber.join(reading)).map((word) => word.id)).toEqual(['accepted-first', 'reserved-first']);
  }),
);
it.effect(
  'duplicate handers share an acceptance failure and leave no durable input',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    storage.faults.put = new Error('acceptance failed');
    window.signalQueue(runRef.id);
    const outcomes = yield* Effect.all(
      [Effect.flip(window.enqueue(runRef, item(signal('same')))), Effect.flip(window.enqueue(runRef, item(signal('same'))))],
      { concurrency: 2 },
    );
    for (const outcome of outcomes) {
      expect(outcome).toBeInstanceOf(ThreadStorageFailed);
      expect(threadCauseOf(outcome)).toBe(storage.faults.put);
    }
    expect(yield* storage.inbox.receipt('same')).toBeUndefined();
  }),
);
it.effect(
  'duplicate input for an ended run is refused without a reservation or durable row',
  Effect.fnUntraced(function* () {
    const { window, storage, driven } = yield* inboxWorld();
    driven.running = false;
    const queue = window.signalQueue(runRef.id);
    expect(
      yield* Effect.all([window.enqueue(runRef, item(signal('same'))), window.enqueue(runRef, item(signal('same')))], { concurrency: 2 }),
    ).toEqual(['not-running', 'not-running']);
    expect(queue.hasPending()).toBe(false);
    expect(yield* storage.inbox.receipt('same')).toBeUndefined();
  }),
);
for (const state of ['foreign-owner', 'ended']) {
  it.effect(
    `reconciliation refuses a ${state} run and keeps its accepted input durable`,
    Effect.fnUntraced(function* () {
      const { window, storage, driven } = yield* inboxWorld();
      window.signalQueue(runRef.id);
      yield* storage.inbox.put(item(signal('unread')));
      if (state === 'foreign-owner') driven.processOwner = 'successor-process';
      else driven.running = false;
      expect(yield* Effect.flip(window.read(runRef))).toMatchObject({ _tag: 'ThreadRunConflict', runId: runRef.id });
      expect(yield* storage.inbox.receipt('unread')).toMatchObject({ state: 'queued' });
    }),
  );
}
it.effect(
  'history-only delivered input is not an unread steer',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    yield* storage.inbox.put(item(signal('history-only')));
    yield* storage.inbox.deliver(['history-only'], runRef.id);
    expect(yield* window.steeredUnread(runRef.threadId)).toBe(false);
  }),
);
it.effect(
  'accepted reports reconcile before final-step pending detection and are read once',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    window.signalQueue(runRef.id);
    yield* storage.inbox.put({
      id: 'report-1',
      threadId: runRef.threadId,
      sender: { kind: 'thread', threadId: 'child', name: 'worker' },
      kind: 'envelope',
      body: { intent: 'report', text: 'Accepted report', inReplyTo: 'task-1' },
      occurredAt: '2026-06-26T10:00:00.000Z',
    });
    expect(yield* window.hasPending(runRef)).toBe(true);
    expect(yield* window.read(runRef)).toMatchObject([
      { id: 'report-1', type: 'report', text: 'Accepted report', from: 'worker', envelopeId: 'report-1' },
    ]);
    expect(yield* window.hasPending(runRef)).toBe(false);
    expect(yield* window.read(runRef)).toEqual([]);
  }),
);
it.effect(
  'an empty input boundary needs no write unit',
  Effect.fnUntraced(function* () {
    const aggregate = makeAggregateStorage();
    aggregate.updateFailure = new Error('An empty input boundary entered a write unit.');
    const { window } = yield* inboxWorld({ aggregate });
    window.signalQueue(runRef.id);
    expect(yield* window.hasPending(runRef)).toBe(false);
    expect(yield* window.read(runRef)).toEqual([]);
  }),
);
it.effect(
  'tasks and turns remain queued for the next turn despite a local signal queue',
  Effect.fnUntraced(function* () {
    const { window, storage } = yield* inboxWorld();
    window.signalQueue(runRef.id);
    const task: ThreadInboxItemValues = {
      id: 'task-1',
      threadId: runRef.threadId,
      sender: { kind: 'host' },
      kind: 'task',
      body: { intent: 'task', text: 'Next task', inReplyTo: null },
      occurredAt: '2026-06-26T10:00:00.000Z',
    };
    yield* window.enqueue(runRef, task);
    yield* window.enqueue(runRef, { ...task, id: 'turn-1', kind: 'turn', sender: { kind: 'reader' }, body: { text: 'Next turn' } });
    expect(yield* window.hasPending(runRef)).toBe(false);
    expect(yield* window.read(runRef)).toEqual([]);
    expect(yield* storage.inbox.receipt(task.id)).toMatchObject({ state: 'queued' });
    expect(yield* storage.inbox.receipt('turn-1')).toMatchObject({ state: 'queued' });
  }),
);
const runRef = { id: 'run-1', threadId: 'thread-1' };
function signal(id: string): ThreadSignal {
  return {
    id,
    occurredAt: '2026-06-26T10:00:00.000Z',
    text: 'use this before the next tool call',
    type: 'user-message',
    addressee: 'reader',
  };
}
const item = (words: ThreadSignal) => inboxSignalValues(runRef.threadId, words);
const inboxWorld = Effect.fnUntraced(function* (
  over: {
    storage?: ReturnType<typeof inboxFixture>;
    aggregate?: InMemoryAggregateStorage;
  } = {},
) {
  const storage = over.storage ?? inboxFixture();
  const aggregate = over.aggregate ?? makeAggregateStorage();
  const driven = { running: true, processOwner: 'test-owner' };
  const unread = () => Effect.die(new Error('This inbox does not use this ledger operation.'));
  const ledger = ThreadRunLedger.of({
    runById: unread,
    isRunning: unread,
    runningHere: unread,
    activeRun: unread,
    activeRunIn: unread,
    runningOf: unread,
    runsOf: unread,
    latestRuns: unread,
    reapable: unread,
    latestRun: (id, statuses) =>
      Effect.sync(() => {
        if (!driven.running || id !== runRef.threadId || (statuses !== undefined && !statuses.includes('running'))) return null;
        return runRow(runRef.id, { ownerId: driven.processOwner });
      }),
  });
  const context = yield* Layer.build(
    threadRunInboxLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          threadChangesLayer,
          ThreadEntryKinds.layer([]),
          Layer.succeed(ThreadOwner, ThreadOwner.of({ id: 'test-owner' })),
          Layer.succeed(ThreadInbox, storage.inbox),
          Layer.succeed(ThreadRunLedger, ledger),
          Layer.succeed(ThreadStore, aggregate),
          Layer.succeed(ThreadTransitions, aggregate),
          Layer.succeed(ThreadEventJournal, recordingJournal().log),
        ),
      ),
    ),
  );
  return { window: Context.get(context, ThreadRunInbox), storage, driven };
});
