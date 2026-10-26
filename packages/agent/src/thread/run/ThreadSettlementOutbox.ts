import { Cause, Clock, Context, Data, Deferred, Effect, Exit, FiberSet, Layer, Tracer } from 'effect';
import type { EndingRunner } from '../ending';
import { activity, note } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { describeErrors } from '@runlith/utils/error';
import type { ThreadNotificationRecord } from '../storage/settlement';
import { ThreadCallBroke, type ThreadBorderFailed, type ThreadPortFailure } from '../ThreadBorder';
import { ThreadOwner, ThreadSettlementRhythm, ThreadRunStoreFactory } from '../ThreadPorts';
import type { RunNote } from './notes';
import { settledEvent, type ThreadRunRef, type ThreadRunSettled } from './ThreadRunLedger';
import { ThreadRunSettlements } from './ThreadRunSettlements';
export const SETTLEMENT = activityKind<
  {
    readonly attempt: string | null;
  },
  {
    readonly confirmed?: boolean;
  }
>('settlement');
export type SettlementNote = {
  readonly type: 'settlement-phase';
  readonly phase: ThreadNotificationRecord['phase'];
  readonly subscriber: string | null;
};
type Publication = {
  readonly event: ThreadRunSettled;
  readonly notification: ThreadNotificationRecord | null;
};
type NotificationFailure = NonNullable<ThreadNotificationRecord['lastFailure']>;
export type SettlementPublishing = {
  readonly run: ThreadRunRef;
  readonly delivered: Effect.Effect<void>;
};
export type SettlementBinding = {
  readonly runner: Context.Service.Shape<typeof EndingRunner>;
  readonly publish: (threadId: string) => Effect.Effect<void, ThreadBorderFailed>;
};
export class SettlementClaimLost extends Data.TaggedError('SettlementClaimLost')<{
  readonly runId: string;
  readonly attemptId: string | null;
}> {}
export class ThreadSettlementOutbox extends Context.Service<
  ThreadSettlementOutbox,
  {
    publish(event: ThreadRunSettled, notification: ThreadNotificationRecord | null): Effect.Effect<void>;
    wake(event: ThreadRunSettled, notification: ThreadNotificationRecord | null): Effect.Effect<void>;
    publishAll(publications: readonly Publication[]): Effect.Effect<void>;
    publishing(threadIds: readonly string[]): readonly SettlementPublishing[];
    notifySettledRuns(): Effect.Effect<number, ThreadPortFailure>;
    bind(binding: SettlementBinding): Effect.Effect<void>;
  }
>()('@runlith/agent/ThreadSettlementOutbox') {}
export const threadSettlementOutboxLayer = Layer.effect(
  ThreadSettlementOutbox,
  Effect.gen(function* () {
    const maintenance = yield* FiberSet.make<void, ThreadPortFailure>();
    const rhythm = yield* ThreadSettlementRhythm;
    const runs = (yield* ThreadRunStoreFactory).create((yield* ThreadOwner).id);
    const settlements = yield* ThreadRunSettlements;
    let binding: SettlementBinding | null = null;
    const going = new Map<string, { readonly run: ThreadRunRef; readonly ends: Set<Deferred.Deferred<void>> }>();
    const publish = (event: ThreadRunSettled, notification: ThreadNotificationRecord | null): Effect.Effect<void> =>
      Effect.suspend(() => {
        const held = going.get(event.runId) ?? {
          run: { id: event.runId, threadId: event.threadId },
          ends: new Set<Deferred.Deferred<void>>(),
        };
        const ended = Deferred.makeUnsafe<void>();
        held.ends.add(ended);
        going.set(event.runId, held);
        return deliver(event, notification).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              held.ends.delete(ended);
              if (held.ends.size === 0 && going.get(event.runId) === held) going.delete(event.runId);
              Deferred.doneUnsafe(ended, Exit.void);
            }),
          ),
        );
      });
    const deliver = (event: ThreadRunSettled, notification: ThreadNotificationRecord | null): Effect.Effect<void> =>
      Effect.suspend(() => {
        let current = notification;
        let phase: ThreadNotificationRecord['phase'] = 'publication';
        let subscriber: string | null = null;
        const expectedId = notification?.id ?? null;
        const failureOf = <E>(cause: Cause.Cause<E>, at: number): NotificationFailure => ({
          attemptId: expectedId,
          at: new Date(at).toISOString(),
          phase,
          subscriber,
          cause: notificationCause(cause),
        });
        const lost = () => new SettlementClaimLost({ runId: event.runId, attemptId: expectedId });
        const record = Effect.fnUntraced(function* (): Effect.fn.Return<boolean | void> {
          if (current === null) return true;
          const snapshot = current;
          return yield* Effect.suspend(() => runs.writeSettledNotification(event.runId, snapshot, expectedId)).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                const observationFailure = failureOf(cause, yield* Clock.currentTimeMillis);
                if (current) current = { ...current, observationFailure };
                yield* Effect.logWarning('Settlement diagnostic recording failed', {
                  runId: event.runId,
                  threadId: event.threadId,
                  observationFailure,
                  originalFailure: current?.lastFailure ?? null,
                });
              }),
            ),
          );
        });
        const entering = (next: ThreadNotificationRecord['phase'], name: string | null): Effect.Effect<void, SettlementClaimLost> =>
          Effect.suspend(() => {
            phase = next;
            subscriber = name;
            if (current) current = { ...current, phase, subscriber };
            return note<SettlementNote>({ type: 'settlement-phase', phase, subscriber }).pipe(
              Effect.andThen(record()),
              Effect.flatMap((written) => (written === false ? Effect.fail(lost()) : Effect.void)),
            );
          });
        const done = (name: string): Effect.Effect<void, SettlementClaimLost | ThreadPortFailure> =>
          Effect.suspend(() => {
            if (current === null) return Effect.void;
            const delivered = { ...current, delivered: [...current.delivered, name] };
            current = delivered;
            return Effect.flatMap(runs.writeSettledNotification(event.runId, delivered, expectedId), (written) =>
              written ? Effect.void : Effect.fail(lost()),
            );
          });
        const publishing = activity(
          SETTLEMENT,
          { attempt: expectedId },
          Effect.gen(function* () {
            yield* entering('publication', null);
            const bound = binding;
            yield* settlements.publish(
              event,
              { delivered: current?.delivered ?? [], entering: (name) => entering('subscriber', name), done },
              bound === null
                ? undefined
                : bound.runner
                    .run({ ending: event.runId, threadId: event.threadId })
                    .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
            );
            yield* entering('confirmation', null);
            const confirmed = yield* runs.markSettledNotified(event.runId, new Date(yield* Clock.currentTimeMillis), current);
            if (confirmed && bound !== null) yield* bound.publish(event.threadId);
            if (!confirmed)
              yield* Effect.logWarning('Settlement confirmation lost its claim', {
                runId: event.runId,
                attemptId: expectedId,
              });
            return confirmed;
          }),
          {
            thread: event.threadId,
            run: event.runId,
            parent: { run: event.runId },
            actor: { kind: 'server', name: 'settlement' },
            ended: (exit) => (Exit.isSuccess(exit) ? { result: { confirmed: exit.value } } : {}),
          },
        ).pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : Effect.gen(function* () {
                  const original = failureOf(exit.cause, yield* Clock.currentTimeMillis);
                  if (current) current = { ...current, finishedAt: original.at, lastFailure: original };
                  yield* record();
                  yield* Effect.logWarning('Settlement notification failed', {
                    runId: event.runId,
                    threadId: event.threadId,
                    failure: original,
                    detail: Cause.pretty(exit.cause),
                    observationFailure: current?.observationFailure ?? null,
                  });
                }),
          ),
          Effect.catchCause((cause) => Effect.logWarning('Settlement publication ended unsuccessfully', { runId: event.runId, cause })),
        );
        return Effect.gen(function* () {
          const heartbeat = Effect.fn('ThreadSettlementOutbox.heartbeat')(
            function* () {
              yield* runs.heartbeatSettledClaim(event.runId, new Date(yield* Clock.currentTimeMillis), expectedId);
            },
            Effect.catchCause((cause) =>
              Effect.logWarning('Settlement claim heartbeat failed', { error: describeErrors(Cause.prettyErrors(cause)) }),
            ),
          );
          yield* Effect.forkScoped(Effect.forever(Effect.sleep(rhythm.settledHeartbeatIntervalMs).pipe(Effect.andThen(heartbeat))));
          yield* publishing;
        }).pipe(Effect.scoped, (publication) => Effect.updateContext(publication, Context.omit(Tracer.ParentSpan)));
      });
    const publishAll = (publications: readonly Publication[]): Effect.Effect<void> =>
      Effect.suspend(() => {
        const byThread = new Map<string, Publication[]>();
        for (const publication of publications) {
          const held = byThread.get(publication.event.threadId);
          if (held) held.push(publication);
          else byThread.set(publication.event.threadId, [publication]);
        }
        return Effect.forEach(
          [...byThread.values()],
          (ofThread) =>
            Effect.forEach(ofThread, ({ event, notification }) => publish(event, notification), {
              concurrency: 1,
              discard: true,
            }),
          { concurrency: 'unbounded', discard: true },
        );
      });
    return ThreadSettlementOutbox.of({
      publish,
      wake: (event, notification) => Effect.asVoid(FiberSet.run(maintenance, publish(event, notification))),
      publishAll,
      publishing: (threadIds) => {
        const asked = new Set(threadIds);
        return [...going.values()].flatMap((held) =>
          asked.has(held.run.threadId)
            ? [{ run: held.run, delivered: Effect.forEach([...held.ends], (end) => Deferred.await(end), { discard: true }) }]
            : [],
        );
      },
      bind: (bound) =>
        Effect.sync(() => {
          binding = bound;
        }),
      notifySettledRuns: Effect.fn('ThreadSettlementOutbox.notifySettledRuns')(function* () {
        if (binding) yield* binding.runner.recover({ limit: rhythm.settledNotificationBatch });
        const now = new Date(yield* Clock.currentTimeMillis);
        const { claims: rows, exhausted } = yield* runs.claimSettledForNotification({
          heartbeatBefore: new Date(now.getTime() - rhythm.settledClaimAfterMs),
          now,
          limit: rhythm.settledNotificationBatch,
          maxAttempts: rhythm.settledNotifyAttemptLimit,
        });
        for (const spent of exhausted) {
          yield* note<RunNote>({ type: 'notification-exhausted', attempts: spent.attempts, delivered: spent.delivered }, { run: spent.id });
        }
        yield* publishAll(
          rows.map((row) => ({
            event: settledEvent(row),
            notification: row.settledNotification,
          })),
        );
        return rows.length;
      }),
    });
  }),
);
function notificationCause<E>(cause: Cause.Cause<E>): NotificationFailure['cause'] {
  return cause.reasons.map((reason) => {
    const value = reason._tag === 'Fail' ? reason.error : reason._tag === 'Die' ? reason.defect : null;
    const tag = value !== null && typeof value === 'object' && '_tag' in value && typeof value._tag === 'string' ? value._tag : null;
    const port = value !== null && typeof value === 'object' && 'port' in value && typeof value.port === 'string' ? value.port : null;
    return {
      kind: reason._tag === 'Fail' ? 'failure' : reason._tag === 'Die' ? 'defect' : 'interruption',
      tag,
      port,
      message: reason._tag === 'Interrupt' ? 'Publication interrupted' : value instanceof Error ? value.message : String(value),
      detail: describeErrors(Cause.prettyErrors(Cause.fromReasons([reason]))),
      fiberId: reason._tag === 'Interrupt' ? (reason.fiberId ?? null) : null,
    };
  });
}
