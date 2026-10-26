import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { TestClock } from 'effect/testing';
import { Clock, Context, Deferred, Effect, Fiber, Layer } from 'effect';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { agentSpan } from '../../agent/spans';
import { parseThreadRunNotification } from '../persisted';
import { seedThreadNotification, threadNotification } from '../storage/settlement';
import type { ThreadRunStorage } from '../storage/runs';
import { threadHostLayer, ThreadRunStoreFactory, type ThreadTx } from '../ThreadPorts';
import { ThreadCallBroke } from '../ThreadBorder';
import { attempt } from '../storage/memory/attempt';
import { ThreadRunSettlements, threadRunSettlementsLayer, type ThreadRunSettledSubscriber } from './ThreadRunSettlements';
import type { ThreadRunSettled } from './ThreadRunLedger';
import { threadSettlementOutboxLayer, ThreadSettlementOutbox } from './ThreadSettlementOutbox';
import { runRow, unreadRuns } from '../conformance/runCycle/runDoubles';
const rhythm = {
  settledClaimAfterMs: 30_000,
  settledHeartbeatIntervalMs: 30_000,
  settledNotificationBatch: 1,
  settledNotifyAttemptLimit: 3,
};
const event: ThreadRunSettled = {
  runId: 'run-1',
  threadId: 'thread-1',
  kind: 'turn',
  status: 'completed',
  failureReason: null,
  failure: null,
  stoppedBy: null,
};
const broken = () => Effect.fail(new ThreadCallBroke({ cause: new Error('snapshot is unavailable') }));
it.effect(
  'subscriber failure retains its phase and leaves the run unconfirmed without holding later reactions',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    let followed = false;
    const outbox = yield* outboxOver(store.runs, [
      { name: 'reports', handle: broken },
      {
        name: 'follow-up',
        handle: () =>
          Effect.sync(() => {
            followed = true;
          }),
      },
    ]);
    yield* outbox.publish(event, store.row.settledNotification);
    expect(store.row.settledNotifiedAt).toBeNull();
    expect(followed).toBe(true);
    expect(store.row.settledNotification?.lastFailure).toMatchObject({
      phase: 'subscriber',
      subscriber: 'reports',
      cause: [{ kind: 'failure', tag: 'ThreadCallBroke', message: 'snapshot is unavailable' }],
    });
    expect(threadNotification(store.row, rhythm, new Date(yield* Clock.currentTimeMillis))?.state).toBe('retry-wait');
  }),
);
it.effect(
  'confirmation failure is distinct from subscriber failure',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    store.confirmationFailure = new Error('confirmation write failed');
    const outbox = yield* outboxOver(store.runs);
    yield* outbox.publish(event, store.row.settledNotification);
    expect(store.row.settledNotification?.lastFailure).toMatchObject({ phase: 'confirmation', subscriber: null });
    expect(store.row.settledNotifiedAt).toBeNull();
  }),
);
it.effect(
  'diagnostic write failure permits reactions and confirmation while retaining separate evidence',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    store.observationFailure = new Error('diagnostic storage failed');
    const effects: string[] = [];
    const outbox = yield* outboxOver(store.runs, [
      {
        name: 'follow-up',
        handle: () =>
          Effect.sync(() => {
            effects.push(event.runId);
          }),
      },
    ]);
    yield* outbox.publish(event, store.row.settledNotification);
    expect(effects).toEqual([event.runId]);
    expect(store.row.settledNotifiedAt).not.toBeNull();
    expect(store.row.settledNotification?.lastFailure).toBeNull();
    expect(store.row.settledNotification?.observationFailure?.cause[0]).toMatchObject({ kind: 'failure', tag: 'ThreadStorageFailed' });
  }),
);
it.effect(
  'reclaim confirms while preserving the earlier failure and persisted ending actor',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    store.row.settledBy = 'reader';
    let unavailable = true;
    const endings: ThreadRunSettled[] = [];
    const outbox = yield* outboxOver(store.runs, [
      {
        name: 'reports',
        handle: (ending) =>
          unavailable
            ? broken()
            : Effect.sync(() => {
                endings.push(ending);
              }),
      },
    ]);
    yield* outbox.publish({ ...event, status: 'aborted', stoppedBy: 'reader' }, store.row.settledNotification);
    const original = store.row.settledNotification?.lastFailure;
    unavailable = false;
    store.row.heartbeatAt = new Date((yield* Clock.currentTimeMillis) - rhythm.settledClaimAfterMs - 1);
    store.row.status = 'aborted';
    expect(yield* outbox.notifySettledRuns()).toBe(1);
    expect(store.row.settledNotifyAttempts).toBe(1);
    expect(store.row.settledNotification?.lastFailure).toEqual(original);
    expect(endings[0]?.stoppedBy).toBe('reader');
    expect(threadNotification(store.row, rhythm, new Date(yield* Clock.currentTimeMillis))?.state).toBe('confirmed');
  }),
);
it.effect(
  'an active final claim becomes exhausted only after its completion fails',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const now = new Date(yield* Clock.currentTimeMillis);
    store.row.settledNotifyAttempts = rhythm.settledNotifyAttemptLimit;
    store.row.heartbeatAt = now;
    store.row.settledNotification = seedThreadNotification(store.row.id, now, null);
    expect(threadNotification(store.row, rhythm, now)?.state).toBe('claimed');
    const outbox = yield* outboxOver(store.runs, [{ name: 'reports', handle: broken }]);
    yield* outbox.publish(event, store.row.settledNotification);
    expect(threadNotification(store.row, rhythm, now)?.state).toBe('notification-exhausted');
    store.row.heartbeatAt = new Date((yield* Clock.currentTimeMillis) - rhythm.settledClaimAfterMs - 1);
    expect(yield* outbox.notifySettledRuns()).toBe(0);
  }),
);
it.effect(
  'retry preserves confirmed subscriber effects exactly once',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const effects: string[] = [];
    let secondUp = false;
    const outbox = yield* outboxOver(store.runs, [
      {
        name: 'first',
        handle: () =>
          Effect.sync(() => {
            effects.push('first');
          }),
      },
      {
        name: 'second',
        handle: () =>
          secondUp
            ? Effect.sync(() => {
                effects.push('second');
              })
            : broken(),
      },
    ]);
    yield* outbox.publish(event, store.row.settledNotification);
    expect(store.row.settledNotification?.delivered).toEqual(['first']);
    secondUp = true;
    store.row.heartbeatAt = new Date((yield* Clock.currentTimeMillis) - rhythm.settledClaimAfterMs - 1);
    expect(yield* outbox.notifySettledRuns()).toBe(1);
    expect(effects).toEqual(['first', 'second']);
    expect(threadNotification(store.row, rhythm, new Date(yield* Clock.currentTimeMillis))?.state).toBe('confirmed');
  }),
);
it.effect(
  'a lost confirmation retries without repeating delivered subscriber effects',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    store.confirmationFailure = new Error('process lost before confirm');
    const reports: string[] = [];
    const outbox = yield* outboxOver(store.runs, [
      {
        name: 'reports',
        handle: () =>
          Effect.sync(() => {
            reports.push(event.runId);
          }),
      },
    ]);
    yield* outbox.publish(event, store.row.settledNotification);
    expect(store.row.settledNotifiedAt).toBeNull();
    store.confirmationFailure = null;
    store.row.heartbeatAt = new Date((yield* Clock.currentTimeMillis) - rhythm.settledClaimAfterMs - 1);
    expect(yield* outbox.notifySettledRuns()).toBe(1);
    expect(reports).toEqual([event.runId]);
    expect(threadNotification(store.row, rhythm, new Date(yield* Clock.currentTimeMillis))?.state).toBe('confirmed');
  }),
);
it.effect(
  'exhaustion is reported once and only redelivery makes the ending eligible again',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const recording = activityRecording();
    let up = false;
    const outbox = yield* outboxOver(store.runs, [{ name: 'reports', handle: () => (up ? Effect.void : broken()) }]);
    const notify = outbox.notifySettledRuns().pipe(Effect.provideService(ActivityLog, recording.log));
    const exhaustions = () => recording.runNotes(event.runId).filter((note) => note.type === 'notification-exhausted').length;
    for (let attempt = 1; attempt <= rhythm.settledNotifyAttemptLimit; attempt += 1) {
      store.row.heartbeatAt = new Date((yield* Clock.currentTimeMillis) - rhythm.settledClaimAfterMs - 1);
      expect(yield* notify).toBe(1);
    }
    store.row.heartbeatAt = new Date((yield* Clock.currentTimeMillis) - rhythm.settledClaimAfterMs - 1);
    expect(yield* notify).toBe(0);
    expect(threadNotification(store.row, rhythm, new Date(yield* Clock.currentTimeMillis))?.state).toBe('notification-exhausted');
    expect(exhaustions()).toBe(1);
    expect(yield* notify).toBe(0);
    expect(exhaustions()).toBe(1);
    up = true;
    expect(yield* store.runs.redeliverSettled(event.runId, rhythm.settledNotifyAttemptLimit)).toBe(true);
    store.row.heartbeatAt = new Date((yield* Clock.currentTimeMillis) - rhythm.settledClaimAfterMs - 1);
    expect(yield* notify).toBe(1);
    expect(threadNotification(store.row, rhythm, new Date(yield* Clock.currentTimeMillis))?.state).toBe('confirmed');
  }),
);
it.effect(
  'a process lost on the final attempt is reported exhausted by the next claim',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const recording = activityRecording();
    const outbox = yield* outboxOver(store.runs);
    store.row.settledNotifyAttempts = rhythm.settledNotifyAttemptLimit;
    store.row.settledNotification = seedThreadNotification(event.runId, new Date(0), null);
    store.row.heartbeatAt = new Date((yield* Clock.currentTimeMillis) - rhythm.settledClaimAfterMs - 1);
    expect(yield* outbox.notifySettledRuns().pipe(Effect.provideService(ActivityLog, recording.log))).toBe(0);
    expect(recording.runNotes(event.runId)).toEqual([
      { type: 'notification-exhausted', attempts: rhythm.settledNotifyAttemptLimit, delivered: [] },
    ]);
    expect(yield* store.runs.redeliverSettled(event.runId, rhythm.settledNotifyAttemptLimit)).toBe(true);
  }),
);
it.effect(
  'a superseded claim stops before the next subscriber effect',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const recording = activityRecording();
    const effects: string[] = [];
    const outbox = yield* outboxOver(store.runs, [
      {
        name: 'first',
        handle: Effect.fnUntraced(function* () {
          effects.push('first');
          store.row.settledNotification = seedThreadNotification(
            event.runId,
            new Date(yield* Clock.currentTimeMillis),
            store.row.settledNotification,
          );
        }),
      },
      {
        name: 'second',
        handle: () =>
          Effect.sync(() => {
            effects.push('second');
          }),
      },
    ]);
    yield* outbox.publish(event, store.row.settledNotification).pipe(Effect.provideService(ActivityLog, recording.log));
    expect(recording.activities()[0]?.ended).toMatchObject({ outcome: 'failed', reason: 'SettlementClaimLost' });
    expect(effects).toEqual(['first']);
    expect(store.row.settledNotifiedAt).toBeNull();
  }),
);
it.effect(
  'interruption records its cause and releases the subscriber scope',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const entered = yield* Deferred.make<void>();
    let released = false;
    const outbox = yield* outboxOver(store.runs, [
      {
        name: 'reports',
        handle: Effect.fnUntraced(function* () {
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.sync(() => {
              released = true;
            }),
          );
          yield* Deferred.succeed(entered, undefined);
          yield* Effect.never;
        }, Effect.scoped),
      },
    ]);
    const publishing = yield* Effect.forkScoped(outbox.publish(event, store.row.settledNotification));
    yield* Deferred.await(entered);
    yield* TestClock.adjust(rhythm.settledHeartbeatIntervalMs);
    expect(store.row.heartbeatAt.getTime()).toBe(yield* Clock.currentTimeMillis);
    const lastHeartbeat = store.row.heartbeatAt;
    yield* Fiber.interrupt(publishing);
    yield* TestClock.adjust(rhythm.settledHeartbeatIntervalMs);
    expect(store.row.heartbeatAt).toBe(lastHeartbeat);
    expect(store.row.settledNotifiedAt).toBeNull();
    expect(store.row.settledNotification?.lastFailure?.cause[0]?.kind).toBe('interruption');
    expect(released).toBe(true);
  }),
);
it.effect(
  'a woken publication stands for its thread until it is delivered',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const outbox = yield* outboxOver(store.runs, [
      { name: 'reports', handle: () => Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)) },
    ]);
    yield* outbox.wake(event, store.row.settledNotification);
    yield* Deferred.await(entered);
    const standing = outbox.publishing([event.threadId, 'thread-2']);
    expect(standing.map((publishing) => publishing.run)).toEqual([{ id: event.runId, threadId: event.threadId }]);
    yield* Deferred.succeed(release, undefined);
    yield* Effect.forEach(standing, (publishing) => publishing.delivered, { discard: true });
    expect(store.row.settledNotifiedAt).not.toBeNull();
    expect(outbox.publishing([event.threadId])).toEqual([]);
  }),
);
it.effect(
  'publication inside a delivery span permits nested reactions and confirms',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const reported: string[] = [];
    const outbox = yield* outboxOver(store.runs, [
      {
        name: 'envelope reports',
        handle: (ending) =>
          Effect.sync(() => {
            reported.push(ending.runId);
          }).pipe(
            agentSpan({
              type: 'delivery',
              envelopeId: 'envelope:report:task-1:run-1',
              intent: 'report',
              senderThreadId: 'thread-1',
              targetThreadId: 'thread-2',
            }),
          ),
      },
    ]);
    yield* outbox.publish(event, store.row.settledNotification).pipe(
      agentSpan({
        type: 'delivery',
        envelopeId: 'envelope:task-1',
        intent: 'task',
        senderThreadId: 'thread-2',
        targetThreadId: 'thread-1',
      }),
    );
    expect(reported).toEqual([event.runId]);
    expect(store.row.settledNotification?.lastFailure).toBeNull();
    expect(store.row.settledNotifiedAt).not.toBeNull();
  }),
);
it.effect(
  'activity records entered phases and the reaction that broke',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const recording = activityRecording();
    const outbox = yield* outboxOver(store.runs, [{ name: 'reports', handle: broken }]);
    yield* outbox.publish(event, store.row.settledNotification).pipe(Effect.provideService(ActivityLog, recording.log));
    const [settlement] = recording.activities();
    expect(settlement?.opened).toMatchObject({ kind: 'settlement', thread: 'thread-1', run: 'run-1', parent: { run: 'run-1' } });
    expect(settlement?.notes).toEqual([
      { type: 'settlement-phase', phase: 'publication', subscriber: null },
      { type: 'settlement-phase', phase: 'subscriber', subscriber: 'reports' },
    ]);
    expect(settlement?.ended).toMatchObject({ outcome: 'failed', reason: 'ThreadCallBroke' });
  }),
);
it.effect(
  'confirmed publication records confirmation under the claim it held',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const recording = activityRecording();
    const outbox = yield* outboxOver(store.runs);
    yield* outbox.publish(event, store.row.settledNotification).pipe(Effect.provideService(ActivityLog, recording.log));
    const [settlement] = recording.activities();
    expect(settlement?.notes.at(-1)).toEqual({ type: 'settlement-phase', phase: 'confirmation', subscriber: null });
    expect(settlement?.ended).toMatchObject({ outcome: 'ok', result: { confirmed: true } });
  }),
);
it.effect(
  'defects remain distinct from typed subscriber failures in persisted evidence',
  Effect.fnUntraced(function* () {
    const store = notificationStore();
    const outbox = yield* outboxOver(store.runs, [{ name: 'reports', handle: () => Effect.die(new Error('defective subscriber')) }]);
    yield* outbox.publish(event, store.row.settledNotification);
    expect(store.row.settledNotification?.lastFailure?.cause[0]?.kind).toBe('defect');
  }),
);
const outboxOver = Effect.fnUntraced(function* (runs: ThreadRunStorage<ThreadTx>, subscribers: readonly ThreadRunSettledSubscriber[] = []) {
  const listeners = Layer.effectDiscard(
    Effect.gen(function* () {
      const settlements = yield* ThreadRunSettlements;
      for (const subscriber of subscribers) yield* settlements.subscribe(subscriber);
    }),
  ).pipe(Layer.provideMerge(threadRunSettlementsLayer));
  const context = yield* Layer.build(
    threadSettlementOutboxLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          listeners,
          Layer.succeed(ThreadRunStoreFactory, ThreadRunStoreFactory.of({ create: () => runs })),
          threadHostLayer({
            rhythms: {
              lease: { heartbeatIntervalMs: 30_000, staleRunningAfterMs: 30_000, takeoverAfterMs: 0 },
              reaper: { staleSweepIntervalMs: 30_000, recoveryBatch: 1, resumeWithinMs: 30_000, resumeAttemptLimit: 1 },
              settlement: rhythm,
              streamFlushIntervalMs: 0,
            },
            ownerId: runs.ownerId,
          }),
        ),
      ),
    ),
  );
  return Context.get(context, ThreadSettlementOutbox);
});
function notificationStore() {
  const row = runRow(event.runId, { status: 'completed', progress: { stage: 'completed', message: null }, finishedAt: new Date(0) });
  const failures: {
    observationFailure: Error | null;
    confirmationFailure: Error | null;
  } = {
    observationFailure: null,
    confirmationFailure: null,
  };
  const runs: ThreadRunStorage<ThreadTx> = {
    ...unreadRuns,
    writeSettledNotification: (id, record, expected) =>
      attempt('writeSettledNotification', () => {
        const advances = record.delivered.length !== (row.settledNotification?.delivered.length ?? 0);
        if (failures.observationFailure && !advances) throw failures.observationFailure;
        if (id !== row.id || row.ownerId !== runs.ownerId || row.settledNotifiedAt || row.settledNotification?.id !== expected)
          return false;
        row.settledNotification = parseThreadRunNotification(JSON.parse(JSON.stringify(record)));
        return true;
      }),
    markSettledNotified: (id, at, record) =>
      attempt('markSettledNotified', () => {
        if (failures.confirmationFailure) throw failures.confirmationFailure;
        if (id !== row.id || row.ownerId !== runs.ownerId || row.settledNotifiedAt || row.settledNotification?.id !== record?.id)
          return false;
        row.settledNotifiedAt = at;
        row.settledNotification = record ? { ...record, phase: 'confirmation', subscriber: null, finishedAt: at.toISOString() } : null;
        return true;
      }),
    heartbeatSettledClaim: (id, at, expected) =>
      Effect.sync(() => {
        if (id === row.id && row.ownerId === runs.ownerId && !row.settledNotifiedAt && row.settledNotification?.id === expected)
          row.heartbeatAt = at;
      }),
    claimSettledForNotification: (input) =>
      Effect.sync(() => {
        if (row.status === 'running' || row.settledNotifiedAt || row.heartbeatAt >= input.heartbeatBefore)
          return { claims: [], exhausted: [] };
        if (row.settledNotifyAttempts >= input.maxAttempts) {
          if (row.settledNotification?.exhaustedAt !== null) return { claims: [], exhausted: [] };
          row.settledNotification = { ...row.settledNotification, exhaustedAt: input.now.toISOString() };
          return {
            claims: [],
            exhausted: [
              { id: row.id, threadId: row.threadId, attempts: row.settledNotifyAttempts, delivered: row.settledNotification.delivered },
            ],
          };
        }
        row.heartbeatAt = input.now;
        row.settledNotifyAttempts += 1;
        row.settledNotification = seedThreadNotification(row.id, input.now, row.settledNotification);
        return {
          claims: [
            {
              id: row.id,
              threadId: row.threadId,
              kind: row.kind,
              status: row.status,
              failureReason: row.failureReason,
              failure: row.failure,
              settledBy: row.settledBy,
              settledNotification: row.settledNotification,
              attempt: row.settledNotifyAttempts,
            },
          ],
          exhausted: [],
        };
      }),
    redeliverSettled: (id, maxAttempts) =>
      Effect.sync(() => {
        if (id !== row.id || row.status === 'running' || row.settledNotifiedAt || row.settledNotifyAttempts < maxAttempts) return false;
        row.settledNotifyAttempts = 0;
        if (row.settledNotification) row.settledNotification = { ...row.settledNotification, exhaustedAt: null };
        return true;
      }),
  };
  return {
    row,
    runs,
    set observationFailure(value: Error | null) {
      failures.observationFailure = value;
    },
    set confirmationFailure(value: Error | null) {
      failures.confirmationFailure = value;
    },
  };
}
