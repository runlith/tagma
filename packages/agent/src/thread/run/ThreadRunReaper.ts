import { Cause, Clock, Context, Deferred, Effect, FiberMap, FiberSet, Layer, Schedule } from 'effect';
import { note } from '@runlith/activity/Activity';
import type { RunNote } from './notes';
import {
  THREAD_RUN_AWAITING_QUESTION_STAGE,
  type HostedResume,
  type ThreadAbandonedRun,
  type ThreadRunReapResult,
  type ThreadRunReapSelector,
} from '../storage/runs';
import { type ThreadBorderFailed, type ThreadPortFailure, threadCauseOf } from '../ThreadBorder';
import { threadFailureMessage } from '../ThreadFailure';
import { ThreadLeaseRhythm, ThreadOwner, ThreadReaperRhythm } from '../ThreadPorts';
import { RunLifecycle } from './lifecycle/RunLifecycle';
import { RunControl } from './RunControl';
import { RunScheduler } from './scheduler/RunScheduler';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadSettlementOutbox } from './ThreadSettlementOutbox';

export type ThreadAbandonedRuns = {
  readonly resumable: readonly ThreadAbandonedRun[];
  readonly cuttable: readonly ThreadAbandonedRun[];
};

export type RecoveryOutcome = HostedResume | 'resume-failed' | 'stopped' | 'cut';

export class ThreadRunReaper extends Context.Service<
  ThreadRunReaper,
  {
    recover(): Effect.Effect<number, ThreadBorderFailed>;
    triggerRecovery(): Effect.Effect<void>;
    abandonedRuns(now: Date): Effect.Effect<ThreadAbandonedRuns, ThreadPortFailure>;
    recoverStaleRuns(): Effect.Effect<number, ThreadPortFailure>;
    dropped(threadId: string, failure: string): Effect.Effect<RecoveryOutcome | null, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadRunReaper') {}

export const threadRunReaperLayer = Layer.effect(
  ThreadRunReaper,
  Effect.gen(function* () {
    const scheduler = yield* RunScheduler;
    const maintenance = yield* FiberSet.make<void, never>();
    const timers = yield* FiberMap.make<'takeover' | 'sweep', void, never>();
    const rhythm = yield* ThreadReaperRhythm;
    const lease = yield* ThreadLeaseRhythm;
    const ownerId = (yield* ThreadOwner).id;
    const ledger = yield* ThreadRunLedger;
    const lifecycle = yield* RunLifecycle;
    const control = yield* RunControl;
    const outbox = yield* ThreadSettlementOutbox;
    const runMaintenance = yield* FiberSet.runtime(maintenance)();
    const runTimer = yield* FiberMap.runtime(timers)();
    let recoveryPass: Deferred.Deferred<number, ThreadBorderFailed> | null = null;
    let sweeping = false;
    let closing = false;

    const maintain = (name: string, work: Effect.Effect<unknown, ThreadBorderFailed>): void => {
      runMaintenance(
        work.pipe(
          Effect.asVoid,
          Effect.catchCause((cause) => Effect.logWarning('thread run recovery failed', { work: name, cause: Cause.pretty(cause) })),
        ),
      );
    };

    const lost = (candidate: ThreadAbandonedRun): Effect.Effect<RecoveryOutcome> =>
      Effect.as(note<RunNote>({ type: 'ownership-lost', afterMs: candidate.gapMs }, { run: candidate.id }), 'ownership-lost' as const);

    const cut = (candidate: ThreadAbandonedRun, reason?: string): Effect.Effect<RecoveryOutcome, ThreadPortFailure> =>
      Effect.flatMap(lifecycle.cut(candidate, reason), (outcome) =>
        outcome === 'lost' ? lost(candidate) : Effect.succeed('cut' as const),
      );

    const resumeFailed = Effect.fnUntraced(function* (
      candidate: ThreadAbandonedRun,
      failure: ThreadBorderFailed,
    ): Effect.fn.Return<RecoveryOutcome, ThreadPortFailure> {
      yield* note<RunNote>({ type: 'resume-failed', failure: threadFailureMessage(threadCauseOf(failure)) }, { run: candidate.id });
      yield* control.interrupt(candidate, null);
      const row = yield* ledger.activeRun(candidate.threadId);
      if (row?.id === candidate.id && row.ownerId === ownerId && !control.holds(row.id)) {
        yield* lifecycle.finish({ id: row.id, threadId: row.threadId }, { kind: 'broke', cause: Cause.fail(failure), departing: false });
      }
      return 'resume-failed' as const;
    });

    const decide = Effect.fnUntraced(function* (
      candidate: ThreadAbandonedRun,
      resumable: boolean,
    ): Effect.fn.Return<RecoveryOutcome, ThreadBorderFailed> {
      const run = { id: candidate.id, threadId: candidate.threadId };
      if (candidate.stopRequest !== null) {
        const stopped = yield* lifecycle.stop(run, candidate.stopRequest, false);
        if (stopped !== 'stopped') return yield* lost(candidate);
        yield* control.interrupt(candidate, candidate.stopRequest.by);
        return 'stopped' as const;
      }
      if (!resumable) return yield* cut(candidate);
      const resumed = yield* Effect.result(scheduler.adopt(candidate));
      if (resumed._tag === 'Failure') return yield* resumeFailed(candidate, resumed.failure);
      if (resumed.success === 'ownership-lost') return yield* lost(candidate);
      const failed = candidate.selector.kind === 'dropped' ? candidate.selector.failure : null;
      if (resumed.success === 'declined') {
        return yield* cut(candidate, failed === null ? undefined : `its driver failed and nothing took it up again: ${failed}`);
      }
      if (resumed.success === 'exhausted') {
        const limit = candidate.resumeLimit;
        const spent = `the run exhausted ${limit} crash recovery attempt${limit === 1 ? '' : 's'} without durable progress`;
        return yield* cut(candidate, failed === null ? spent : `${spent}; its driver last failed: ${failed}`);
      }
      return resumed.success;
    });

    const dropped = Effect.fn('ThreadRunReaper.dropped')(function* (
      threadId: string,
      failure: string,
    ): Effect.fn.Return<RecoveryOutcome | null, ThreadBorderFailed> {
      const run = yield* ledger.activeRun(threadId);
      if (run === null || run.ownerId !== ownerId || run.progress.stage === THREAD_RUN_AWAITING_QUESTION_STAGE || control.holds(run.id)) {
        return null;
      }
      yield* note<RunNote>({ type: 'dropped', failure }, { run: run.id });
      const now = yield* Clock.currentTimeMillis;
      const outcome = yield* decide(
        {
          id: run.id,
          threadId,
          kind: run.kind,
          gapMs: now - run.heartbeatAt.getTime(),
          selector: { kind: 'dropped', failure },
          resumeLimit: rhythm.resumeAttemptLimit,
          stopRequest: run.stopRequest,
        },
        true,
      );
      yield* outbox.notifySettledRuns();
      return outcome;
    });

    const abandonedRuns = Effect.fnUntraced(function* (now: Date): Effect.fn.Return<ThreadAbandonedRuns, ThreadPortFailure> {
      const page = rhythm.recoveryBatch;
      const silence: ThreadRunReapSelector = { kind: 'foreign-owner', heartbeatBefore: new Date(now.getTime() - lease.takeoverAfterMs) };
      const stamped = yield* ledger.reapable({ kind: 'handed-over' }, page);
      const silent = yield* ledger.reapable(silence, page);
      const measured = (rows: readonly ThreadRunReapResult[], selector: ThreadRunReapSelector) =>
        rows.map((row) => ({
          id: row.id,
          threadId: row.threadId,
          kind: row.kind,
          gapMs: now.getTime() - (row.handedOverAt ?? row.heartbeatAt).getTime(),
          selector,
          resumeLimit: rhythm.resumeAttemptLimit,
          stopRequest: row.stopRequest,
        }));
      const candidates = [...measured(stamped, { kind: 'handed-over' }), ...measured(silent, silence)]
        .sort((a, b) => a.gapMs - b.gapMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, page);
      const resumable: ThreadAbandonedRun[] = [];
      const cuttable: ThreadAbandonedRun[] = [];
      for (const candidate of candidates) {
        if (candidate.gapMs >= 0 && candidate.gapMs < rhythm.resumeWithinMs) resumable.push(candidate);
        else cuttable.push(candidate);
      }
      return { resumable, cuttable };
    });

    const pass = Effect.fnUntraced(function* (): Effect.fn.Return<number, ThreadBorderFailed> {
      const abandoned = yield* abandonedRuns(new Date(yield* Clock.currentTimeMillis));
      let decided = 0;
      const judged = (candidate: ThreadAbandonedRun, resumable: boolean) =>
        decide(candidate, resumable).pipe(
          Effect.tap((outcome) =>
            Effect.sync(() => {
              if (outcome === 'adopted' || outcome === 'stopped' || outcome === 'cut') decided += 1;
            }),
          ),
          Effect.catch((failure) =>
            Effect.logWarning('an abandoned thread run could not be decided', {
              runId: candidate.id,
              threadId: candidate.threadId,
              failure,
            }),
          ),
        );
      for (const candidate of abandoned.resumable) yield* judged(candidate, true);
      for (const candidate of abandoned.cuttable) yield* judged(candidate, false);
      yield* outbox.notifySettledRuns();
      return decided;
    });

    const recoverStaleRuns = Effect.fnUntraced(function* (): Effect.fn.Return<number, ThreadPortFailure> {
      const failureReason = 'The thread run stopped reporting progress.';
      const now = yield* Clock.currentTimeMillis;
      const selector = { kind: 'stale-heartbeat', heartbeatBefore: new Date(now - lease.staleRunningAfterMs) } as const;
      const candidates = yield* ledger.reapable(selector);
      let reaped = 0;
      for (const candidate of candidates) {
        const abandoned: ThreadAbandonedRun = {
          id: candidate.id,
          threadId: candidate.threadId,
          kind: candidate.kind,
          gapMs: now - candidate.heartbeatAt.getTime(),
          selector,
          resumeLimit: rhythm.resumeAttemptLimit,
          stopRequest: candidate.stopRequest,
        };
        const settled = yield* lifecycle
          .reap(abandoned, failureReason, control.holds(candidate.id))
          .pipe(
            Effect.catch((failure) =>
              Effect.as(
                Effect.logWarning('a stale thread run could not be reaped', { runId: candidate.id, threadId: candidate.threadId, failure }),
                false,
              ),
            ),
          );
        if (settled !== 'committed') continue;
        reaped += 1;
        yield* control.interrupt(candidate, null);
      }
      return reaped;
    });

    const scheduleTakeover = Effect.fnUntraced(function* (): Effect.fn.Return<void, ThreadPortFailure> {
      if (closing) return;
      const now = yield* Clock.currentTimeMillis;
      const [youngest] = yield* ledger.reapable({ kind: 'foreign-owner', heartbeatBefore: new Date(now + 1) }, 1);
      if (!youngest) return;
      const dueIn = youngest.heartbeatAt.getTime() + lease.takeoverAfterMs + 1 - now;
      if (dueIn <= 0) return;
      runTimer(
        'takeover',
        Effect.andThen(
          Effect.sleep(dueIn),
          Effect.sync(() => {
            if (!closing) maintain('takeover recheck', recover().pipe(Effect.asVoid));
          }),
        ),
      );
    });

    const sweepOnce = Effect.fnUntraced(function* (): Effect.fn.Return<void, ThreadBorderFailed> {
      if (closing) return;
      yield* recover();
      yield* recoverStaleRuns();
      yield* outbox.notifySettledRuns();
    });

    const start = Effect.fnUntraced(function* () {
      if (sweeping || closing) return;
      sweeping = true;
      runTimer(
        'sweep',
        Effect.repeat(
          Effect.sync(() => maintain('stale sweep', sweepOnce())),
          Schedule.spaced(rhythm.staleSweepIntervalMs),
        ).pipe(Effect.delay(rhythm.staleSweepIntervalMs), Effect.asVoid),
      );
      yield* outbox.notifySettledRuns();
    });

    const recover = (): Effect.Effect<number, ThreadBorderFailed> =>
      Effect.suspend(() => {
        const owed = start();
        const running = recoveryPass;
        if (running) return Deferred.await(running);
        const settling = Deferred.makeUnsafe<number, ThreadBorderFailed>();
        recoveryPass = settling;
        return Effect.andThen(owed, pass()).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              recoveryPass = null;
              Deferred.doneUnsafe(settling, exit);
              if (!closing) maintain('takeover recheck', scheduleTakeover());
            }),
          ),
        );
      });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closing = true;
      }),
    );

    return ThreadRunReaper.of({
      recover,
      triggerRecovery: () => Effect.sync(() => maintain('run recovery', recover())),
      abandonedRuns,
      recoverStaleRuns,
      dropped,
    });
  }),
);
