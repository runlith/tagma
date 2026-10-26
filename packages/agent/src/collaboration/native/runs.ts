import { Clock, type Context, Duration, Effect, Layer } from 'effect';
import { actDigest, callKey, startedKey, type Keyed, type KeyedSpent } from '../../thread/keyed';
import type { ThreadRow } from '../../thread/rows';
import { ThreadStopping } from '../../thread/run/ThreadStopping';
import { currentRunOf } from '../../thread/state';
import { ThreadSignalConflictError } from '../../thread/run/scheduler/inputs';
import { RunScheduler } from '../../thread/run/scheduler/RunScheduler';
import { ThreadRunLedger } from '../../thread/run/ThreadRunLedger';
import { ThreadNotFoundError } from '../../thread/storage/aggregate';
import { ThreadRunConflictError, ThreadRunNotInterruptedError } from '../../thread/storage/runs';
import { type ThreadBorderFailed, ThreadCallBroke, ThreadMissing, storageFailed, threadCauseOf } from '../../thread/ThreadBorder';
import { TransportCannotError } from '../../thread/record';
import { ThreadInbox, ThreadReadiness, ThreadLeaseRhythm, ThreadStore, ThreadTransitions } from '../../thread/ThreadPorts';
import {
  ThreadDeliveryConflict,
  ThreadRunConflict,
  ThreadRunRefused,
  ThreadRuns,
  type ThreadRunsFailure,
  ThreadRunUnavailable,
} from '../runs';
export function foundThread(
  store: Context.Service.Shape<typeof ThreadStore>,
  threadId: string,
): Effect.Effect<ThreadRow, ThreadMissing | ThreadBorderFailed> {
  return Effect.flatMap(store.find(threadId), (row) => (row ? Effect.succeed(row) : Effect.fail(new ThreadMissing({ threadId }))));
}
export function startKeyed(threadId: string, key: string, request: unknown): Keyed {
  return { evidence: { started: startedKey(threadId, key) }, digest: actDigest(request) };
}
export function startedBy(
  transitions: Context.Service.Shape<typeof ThreadTransitions>,
  threadId: string,
  key: Keyed,
): Effect.Effect<
  | {
      readonly runId: string;
    }
  | KeyedSpent
  | null,
  ThreadRunConflict | ThreadBorderFailed
> {
  return Effect.flatMap(
    transitions.readRecord(threadId, key.evidence),
    (
      reading,
    ): Effect.Effect<
      | {
          readonly runId: string;
        }
      | KeyedSpent
      | null,
      ThreadRunConflict
    > => {
      switch (reading.kind) {
        case 'present':
          if (reading.digest !== key.digest) {
            return Effect.fail(new ThreadRunConflict({ threadId, reason: 'act-id-reused', running: null, key: null }));
          }
          return Effect.succeed({ runId: String(reading.result) });
        case 'spent':
          if (reading.digest !== key.digest) {
            return Effect.fail(new ThreadRunConflict({ threadId, reason: 'act-id-reused', running: null, key: null }));
          }
          return Effect.succeed({ status: 'spent' as const, at: reading.at });
        case 'before-epoch':
          return Effect.succeed({ status: 'spent' as const, at: 'before-epoch' as const });
        default:
          return Effect.succeed(null);
      }
    },
  );
}
function stopKeyed(threadId: string, key: string, expected: string | undefined, by: string): Keyed {
  return {
    evidence: { call: callKey({ operation: 'stop', actor: threadId, key }) },
    digest: actDigest(['stop', by, expected ?? null]),
  };
}
type StopOutcome = 'stopped' | 'not-running';
type StopRecord = {
  readonly status: StopOutcome;
  readonly runId: string | null;
};
const isStopRecord = (result: unknown): result is StopRecord =>
  typeof result === 'object' &&
  result !== null &&
  'status' in result &&
  (result.status === 'stopped' || result.status === 'not-running') &&
  'runId' in result;
function stopReplayed(
  transitions: Context.Service.Shape<typeof ThreadTransitions>,
  threadId: string,
  key: Keyed,
): Effect.Effect<
  | {
      readonly status: StopOutcome;
    }
  | KeyedSpent
  | null,
  ThreadRunConflict | ThreadBorderFailed
> {
  return Effect.flatMap(
    transitions.readRecord(threadId, key.evidence),
    (
      reading,
    ): Effect.Effect<
      | {
          readonly status: StopOutcome;
        }
      | KeyedSpent
      | null,
      ThreadRunConflict
    > => {
      switch (reading.kind) {
        case 'present':
          if (reading.digest !== key.digest) {
            return Effect.fail(new ThreadRunConflict({ threadId, reason: 'act-id-reused', running: null, key: null }));
          }
          return Effect.succeed(isStopRecord(reading.result) ? { status: reading.result.status } : null);
        case 'spent':
          if (reading.digest !== key.digest) {
            return Effect.fail(new ThreadRunConflict({ threadId, reason: 'act-id-reused', running: null, key: null }));
          }
          return Effect.succeed({ status: 'spent' as const, at: reading.at });
        case 'before-epoch':
          return Effect.succeed({ status: 'spent' as const, at: 'before-epoch' as const });
        default:
          return Effect.succeed(null);
      }
    },
  );
}
function recordStop(
  transitions: Context.Service.Shape<typeof ThreadTransitions>,
  threadId: string,
  key: Keyed,
  outcome: StopRecord,
): Effect.Effect<StopOutcome, ThreadBorderFailed> {
  return Effect.map(
    transitions.writeAt(
      threadId,
      Effect.fnUntraced(function* (at) {
        const standing = yield* transitions.readRecord(threadId, key.evidence, at.tx);
        if (standing.kind === 'present' && isStopRecord(standing.result)) return standing.result.status;
        yield* transitions.writeRecord(threadId, key.evidence, { digest: key.digest, result: outcome }, at.tx);
        return outcome.status;
      }),
    ),
    (kept) => kept ?? outcome.status,
  );
}
function runsFailure(threadId: string, call: string): (failure: ThreadBorderFailed) => ThreadRunsFailure {
  return (failure) => {
    const cause = threadCauseOf(failure);
    if (cause instanceof ThreadNotFoundError) return new ThreadMissing({ threadId });
    if (cause instanceof ThreadRunConflictError) {
      return new ThreadRunConflict({ threadId, reason: 'running', running: null, key: null });
    }
    if (cause instanceof TransportCannotError) return new ThreadCallBroke({ cause });
    if (cause instanceof ThreadRunNotInterruptedError) return new ThreadRunRefused({ threadId, reason: 'not-interrupted' });
    if (cause instanceof ThreadSignalConflictError) return new ThreadDeliveryConflict({ threadId, itemId: cause.signalId });
    return storageFailed(call)(failure);
  };
}
export const nativeThreadRunsLayer: Layer.Layer<
  ThreadRuns,
  never,
  ThreadStopping | RunScheduler | ThreadReadiness | ThreadLeaseRhythm | ThreadInbox | ThreadRunLedger | ThreadStore | ThreadTransitions
> = Layer.effect(
  ThreadRuns,
  Effect.gen(function* () {
    const lease = yield* ThreadLeaseRhythm;
    const readiness = yield* ThreadReadiness;
    const stopping = yield* ThreadStopping;
    const inbox = yield* ThreadInbox;
    const ledger = yield* ThreadRunLedger;
    const scheduler = yield* RunScheduler;
    const store = yield* ThreadStore;
    const transitions = yield* ThreadTransitions;
    const thread = (threadId: string) => foundThread(store, threadId);
    return {
      stopReceipt: Effect.fnUntraced(
        function* (threadId, key) {
          const reading = yield* transitions.readRecord(threadId, { call: callKey({ operation: 'stop', actor: threadId, key }) });
          if (reading.kind === 'spent') return { status: 'spent' as const, at: reading.at };
          if (reading.kind === 'before-epoch') return { status: 'spent' as const, at: 'before-epoch' as const };
          if (reading.kind !== 'present' || !isStopRecord(reading.result)) {
            const ended = yield* ledger.latestRun(threadId);
            return ended?.status === 'aborted' && ended.settledBy === 'model' && ended.stopRequest?.key === key
              ? { status: 'stopped' as const, runId: ended.id }
              : null;
          }
          const record = reading.result;
          return reading.digest === stopKeyed(threadId, key, record.runId ?? undefined, 'model').digest ? record : null;
        },
        (effect, threadId, key) => effect.pipe(Effect.mapError(storageFailed('runs.stopReceipt'))),
      ),
      current: Effect.fnUntraced(
        function* (threadId) {
          const run = yield* ledger.activeRun(threadId);
          const moved = run ? yield* store.metadata(threadId) : undefined;
          return run && moved ? currentRunOf(run, moved, new Date(yield* Clock.currentTimeMillis), lease) : null;
        },
        (effect, threadId) => effect.pipe(Effect.mapError(storageFailed('runs.current'))),
      ),
      start: Effect.fnUntraced(
        function* (threadId, input) {
          const child = yield* thread(threadId);
          if (readiness !== null) {
            yield* readiness
              .ready(child)
              .pipe(Effect.mapError((cause) => new ThreadRunUnavailable({ threadId, reason: 'not-ready', cause })));
          }
          const key = startKeyed(child.id, input.itemId, ['start', input.itemId]);
          const started = yield* startedBy(transitions, child.id, key);
          if (started !== null && !('runId' in started)) return started;
          if (started !== null) return { status: 'started' as const, runId: started.runId, acted: false };
          const provided = yield* inbox.receipt(input.itemId);
          if (provided !== undefined && provided.state !== 'queued' && provided.deliveredToRunId !== null) {
            return { status: 'queued' as const, runId: provided.deliveredToRunId, acted: false };
          }
          const standing = yield* ledger.latestRun(child.id);
          if (standing) {
            yield* inbox.deliver([input.itemId], standing.id);
            return { status: 'queued' as const, runId: standing.id, acted: true };
          }
          return yield* scheduler
            .admit(child, {
              kind: 'begin',
              text: input.text,
              start: { startKey: { key: input.itemId, digest: key.digest }, itemId: input.itemId },
            })
            .pipe(
              Effect.map((begun) => ({ status: 'started' as const, runId: begun.runId, acted: begun.acted })),
              Effect.catchIf(
                (failure) => threadCauseOf(failure) instanceof ThreadRunConflictError,
                Effect.fnUntraced(function* () {
                  const opened = yield* ledger.latestRun(child.id);
                  if (!opened) return yield* new ThreadRunConflict({ threadId, reason: 'running', running: null, key: null });
                  yield* inbox.deliver([input.itemId], opened.id);
                  return { status: 'queued' as const, runId: opened.id, acted: true };
                }),
              ),
            );
        },
        (effect, threadId, input) =>
          effect.pipe(
            Effect.catch((failure) =>
              failure instanceof ThreadMissing || failure instanceof ThreadRunUnavailable || failure instanceof ThreadRunConflict
                ? Effect.fail(failure)
                : Effect.fail(runsFailure(threadId, 'runs.start')(failure)),
            ),
          ),
      ),
      deliver: Effect.fnUntraced(
        function* (threadId, input) {
          const item = input.item;
          if (item.state !== 'queued') {
            return {
              status:
                item.deliveredToRunId === null
                  ? ('stored' as const)
                  : item.kind === 'task' && item.state === 'delivered'
                    ? ('queued' as const)
                    : ('delivered' as const),
              runId: item.deliveredToRunId,
              acted: false,
            };
          }
          const recipient = yield* thread(threadId);
          const done = yield* scheduler.admit(recipient, { kind: 'item', item });
          return { acted: true, ...done };
        },
        (effect, threadId, input) =>
          effect.pipe(
            Effect.catch((failure) =>
              failure instanceof ThreadMissing ? Effect.fail(failure) : Effect.fail(runsFailure(threadId, 'runs.deliver')(failure)),
            ),
          ),
      ),
      continue: Effect.fnUntraced(
        function* (threadId, input) {
          const row = yield* thread(threadId);
          const key = startKeyed(row.id, input.request.key, ['continue']);
          const started = yield* startedBy(transitions, row.id, key);
          if (started !== null) {
            return 'runId' in started ? { status: 'continued' as const, runId: started.runId, acted: false } : started;
          }
          if (input.expected !== undefined) {
            const latest = yield* ledger.latestRun(threadId);
            if (latest?.id !== input.expected || latest.status !== 'aborted' || latest.settledBy !== 'model') {
              return yield* new ThreadRunRefused({
                threadId,
                reason: 'not-interrupted',
                detail: 'The turn this model move was resuming ended.',
              });
            }
          }
          const begun = yield* scheduler.admit(row, { kind: 'continue', startKey: { key: input.request.key, digest: key.digest } });
          return { status: 'continued' as const, runId: begun.runId, acted: begun.acted };
        },
        (effect, threadId, input) =>
          effect.pipe(
            Effect.catch((failure) =>
              failure instanceof ThreadMissing || failure instanceof ThreadRunConflict || failure instanceof ThreadRunRefused
                ? Effect.fail(failure)
                : Effect.fail(runsFailure(threadId, 'runs.continue')(failure)),
            ),
          ),
      ),
      stop: Effect.fnUntraced(
        function* (threadId, input) {
          const row = yield* thread(threadId);
          const key = stopKeyed(threadId, input.request.key, input.expected, input.by);
          const first = yield* stopReplayed(transitions, threadId, key);
          if (first !== null) return 'at' in first ? first : { status: first.status, acted: false };
          const answer = yield* stopping.stop(row, {
            door: 'stop_agent',
            by: input.by,
            expected: input.expected,
            at: input.at,
            key: input.request.key,
            settled:
              input.at === 'step'
                ? { within: Duration.millis(Math.max(0, input.request.deadline.getTime() - (yield* Clock.currentTimeMillis))) }
                : undefined,
          });
          if (answer.status === 'still-settling' || answer.status === 'requested') return { status: 'stopping' as const, acted: true };
          const stopped = answer.status === 'stopped' ? ('stopped' as const) : ('not-running' as const);
          const runId = input.expected ?? ('runId' in answer ? answer.runId : null);
          const kept = yield* recordStop(transitions, threadId, key, { status: stopped, runId });
          return { status: kept, acted: kept === stopped };
        },
        (effect, threadId, input) =>
          effect.pipe(
            Effect.catch((failure) =>
              failure instanceof ThreadMissing || failure instanceof ThreadRunConflict || failure instanceof ThreadRunRefused
                ? Effect.fail(failure)
                : Effect.fail(runsFailure(threadId, 'runs.stop')(failure)),
            ),
          ),
      ),
    };
  }),
);
