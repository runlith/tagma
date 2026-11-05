import { Cause, Context, Effect, Layer } from 'effect';
import { note } from '@runlith/activity/Activity';
import type { ThreadStop, ThreadStopAnswer, ThreadStopAsk, ThreadStopOptions } from '../ending';
import type { ThreadMetadataRow } from '../rows';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { ThreadStore } from '../ThreadPorts';
import { makeHistoryMoved } from '../transport/moves';
import { Transports } from '../transport/Transports';
import type { RunNote } from './notes';
import { RunControl } from './RunControl';
import { RunExecution } from './RunExecution';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadRunSettlements } from './ThreadRunSettlements';

export class ThreadStopping extends Context.Service<
  ThreadStopping,
  {
    stop(thread: ThreadMetadataRow, ask: ThreadStopAsk): Effect.Effect<ThreadStopAnswer, ThreadBorderFailed>;
    byReader(
      thread: ThreadMetadataRow,
      expectedRunId: string | undefined,
      options: ThreadStopOptions,
    ): Effect.Effect<ThreadStop, ThreadBorderFailed>;
    release(thread: ThreadMetadataRow, operation?: string): Effect.Effect<'stopped' | 'not-running', ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadStopping') {}

export const threadStoppingLayer = Layer.effect(
  ThreadStopping,
  Effect.gen(function* () {
    const ledger = yield* ThreadRunLedger;
    const execution = yield* RunExecution;
    const transports = yield* Transports;
    const control = yield* RunControl;
    const store = yield* ThreadStore;
    const moved = yield* makeHistoryMoved;
    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'withdrawn run history',
      handle: (event) =>
        event.status !== 'withdrawn'
          ? Effect.void
          : Effect.flatMap(store.metadata(event.threadId), (thread) => (thread === undefined ? Effect.void : moved(thread.id, thread))),
    });

    const retold = Effect.fnUntraced(function* (thread: ThreadMetadataRow, ask: ThreadStopAsk) {
      const latest = yield* ledger.latestRun(thread.id);
      if (latest?.status === 'aborted' && latest.settledBy !== null) yield* control.interrupt(latest, ask.by);
    });

    const stop = Effect.fnUntraced(function* (
      thread: ThreadMetadataRow,
      ask: ThreadStopAsk,
    ): Effect.fn.Return<ThreadStopAnswer, ThreadBorderFailed> {
      const run = yield* ledger.activeRun(thread.id);
      const waited = ask.settled !== undefined ? ask.expected : undefined;
      const target = waited ?? run?.id;
      if (target === undefined) {
        yield* retold(thread, ask);
        return { status: 'nothing-running' as const };
      }
      const told = (outcome: Extract<RunNote, { type: 'stop' }>['outcome'], failure?: string) =>
        note<RunNote>(
          {
            type: 'stop',
            door: ask.door,
            by: ask.by,
            expected: ask.expected ?? null,
            outcome,
            ...(failure === undefined ? {} : { failure }),
          },
          { run: target },
        );
      if (waited === undefined && ask.expected !== undefined && target !== ask.expected) {
        yield* told('run-mismatch');
        return { status: 'run-mismatch' as const, runId: target };
      }
      const current = run?.id === target ? run : null;
      const withdrawing =
        ask.withdraw === true && current !== null && current.kind !== 'compaction' && thread.capabilities.history !== 'none';
      const ended = yield* execution
        .stop(
          { id: target, threadId: thread.id },
          {
            marker: true,
            by: ask.by,
            withdraw: withdrawing ? true : undefined,
            at: ask.at,
            key: ask.key,
            awaitSettled: ask.settled === undefined ? undefined : true,
            within: ask.settled?.within,
          },
        )
        .pipe(Effect.tapCause((cause) => told('failed', Cause.pretty(cause))));
      const answer: ThreadStopAnswer = ended === 'not-running' ? { status: 'nothing-running' } : { status: ended, runId: target };
      yield* told(answer.status);
      return answer;
    });

    return ThreadStopping.of({
      release: Effect.fnUntraced(function* (thread, operation) {
        const transport = yield* Effect.mapError(transports.of(thread), (cause) => new ThreadCallBroke({ cause }));
        return transport.resource === undefined ? ('not-running' as const) : yield* transport.resource.release(thread.id, operation);
      }),
      stop,
      byReader: Effect.fnUntraced(function* (thread, expectedRunId, options) {
        const answer = yield* stop(thread, { ...options, by: 'reader', expected: expectedRunId });
        if (answer.status === 'still-settling') return yield* Effect.die(new Error('A stop that does not wait cannot still be settling.'));
        return answer;
      }),
    });
  }),
);
