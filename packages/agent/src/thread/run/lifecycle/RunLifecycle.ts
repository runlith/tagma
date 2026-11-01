import { Cause, Clock, Context, Effect, Exit, Layer } from 'effect';
import { note } from '@runlith/activity/Activity';
import type { AgentApproval } from '../../../agent/contracts';
import { describeErrors } from '@runlith/utils/error';
import {
  readThreadRunStepsTaken,
  type ThreadEventBody,
  threadCutEvent,
  threadCutSentence,
  threadEntryEvent,
  threadFailureEvent,
} from '../../events';
import { recoveryEntryId } from '../../../transcript/entryNames';
import { actDigest } from '../../keyed';
import type { ThreadRunKind, ThreadRunProgress, ThreadRunRow, ThreadRunStage } from '../../rows';
import type { RunHalt } from '../../../transcript/live';
import type { ThreadRunChange } from '../../state';
import { ROUTED_AWAITING } from '../routedQuestions';
import {
  RunActRefused,
  type RunAct,
  type RunState,
  THREAD_RUN_AWAITING_QUESTION_STAGE,
  THREAD_RUN_RESUMING_STAGE,
  type ThreadAbandonedRun,
  ThreadRunHeldError,
  type ThreadRunStart,
  type ThreadRunStartFrom,
  type ThreadRunStartKey,
  type ThreadRunStopAsked,
  type ThreadRunStopIntent,
} from '../../storage/runs';
import { type ThreadPortFailure, threadCauseOf } from '../../ThreadBorder';
import { threadFailure, ThreadTailLostError } from '../../ThreadFailure';
import { ModelRuns, ThreadLeaseRhythm, ThreadOwner, ThreadResidency, ThreadRunStoreFactory, type ThreadWriteTx } from '../../ThreadPorts';
import { answerOf, prepareTransition, transitionDeps, transitionIn } from '../../transition/kernel';
import type { Decision, TransitionPlan } from '../../transition/port';
import { ThreadRunSequences } from '../../transition/sequence';
import type { RunNote } from '../notes';
import { RunControl } from '../RunControl';
import { mergedStopRequest, type ThreadRunStopRequest } from '../../storage/settlement';
import { RunProgress } from '../RunProgress';
import { RunAdmission } from '../runAdmission';
import { ThreadChanges } from '../ThreadChanges';
import { settledEvent, type ThreadRunRef, type ThreadRunSettled } from '../ThreadRunLedger';
import { ThreadSettlementOutbox } from '../ThreadSettlementOutbox';
import {
  adoptKey,
  displacedTurn,
  type EndAct,
  type EndAnswer,
  type EndPlan,
  endKey,
  IDLE_THREAD,
  makeRunClosing,
  withdrawnTurn,
} from './closing';

export type RunFinish =
  | { readonly kind: 'completed'; readonly unsettled?: string }
  | { readonly kind: 'broke'; readonly cause: Cause.Cause<unknown>; readonly departing: boolean; readonly returnsWords?: true };

export type RunEnd = 'committed' | 'replayed' | 'not-running' | 'left';

export type RunStopped = 'requested' | 'stopped' | 'not-running';

export type RunParked = 'parked' | 'stopped';

export type RunClaim = 'committed' | 'replayed' | 'lost';

export type Adoption = { readonly adopted: ThreadRunRow } | { readonly refused: 'ownership-lost' | 'exhausted' | 'stopped' };

export type RunCreation = {
  readonly kind: ThreadRunKind;
  readonly tx?: ThreadWriteTx;
  readonly startKey?: ThreadRunStartKey;
  readonly runId?: string;
  readonly origin?: 'observed';
};

export type ObservedOpening = {
  readonly startFrom: ThreadRunStartFrom;
  readonly approval: AgentApproval;
  readonly runId: string;
  readonly displaces: string | null;
  readonly startKey: ThreadRunStartKey;
  readonly entries: readonly ThreadEventBody[];
  readonly tx: ThreadWriteTx;
};

export type ObservedRuns = { readonly displaced: ThreadRunRow | null; readonly opened: ThreadRunRow };

export class RunLifecycle extends Context.Service<
  RunLifecycle,
  {
    create(startFrom: ThreadRunStartFrom, approval: AgentApproval, creation: RunCreation): Effect.Effect<ThreadRunStart, ThreadPortFailure>;
    observe(opening: ObservedOpening): Effect.Effect<ObservedRuns, ThreadPortFailure>;
    resume(threadId: string, runId: string, awaiting?: boolean): Effect.Effect<void, ThreadPortFailure>;
    park(run: ThreadRunRef): Effect.Effect<RunParked, ThreadPortFailure>;
    beat(runs: readonly ThreadRunRef[], at: Date): Effect.Effect<readonly ThreadRunStopAsked[], ThreadPortFailure>;
    stop(run: ThreadRunRef, intent: ThreadRunStopIntent, live: boolean, tx?: ThreadWriteTx): Effect.Effect<RunStopped, ThreadPortFailure>;
    drain(run: ThreadRunRef, intent: ThreadRunStopIntent): Effect.Effect<RunStopped, ThreadPortFailure>;
    finish(run: ThreadRunRef, finish: RunFinish, tx?: ThreadWriteTx): Effect.Effect<RunEnd, ThreadPortFailure>;
    handover(runIds: readonly string[], at: Date): Effect.Effect<void, ThreadPortFailure>;
    adopt(candidate: ThreadAbandonedRun, progress?: ThreadRunStage): Effect.Effect<Adoption, ThreadPortFailure>;
    cut(candidate: ThreadAbandonedRun, reason?: string): Effect.Effect<RunClaim, ThreadPortFailure>;
    reap(candidate: ThreadAbandonedRun, reason: string, live: boolean): Effect.Effect<RunClaim, ThreadPortFailure>;
  }
>()('@runlith/agent/RunLifecycle') {}

const UNSPOKEN: ThreadRunStopIntent = { by: null, marker: false, withdraw: false };

const driverHalt = (failure: string, attempt: number, limit: number): RunHalt => ({
  reason: `The agent driver failed: ${failure}. The run is being driven again (attempt ${attempt} of ${limit}).`,
});

const DISPLACED: ThreadRunStopIntent = { by: null, marker: false, withdraw: true };

export const LATE_STOP: ThreadRunProgress = { stage: 'aborted', message: 'The agent finished its turn before the stop reached it.' };

export const runLifecycleLayer = Layer.effect(
  RunLifecycle,
  Effect.gen(function* () {
    const ownerId = (yield* ThreadOwner).id;
    const runs = (yield* ThreadRunStoreFactory).create(ownerId);
    const kernel = yield* transitionDeps;
    const closing = yield* makeRunClosing({ kernel, runs });
    const sequences = yield* ThreadRunSequences;
    const going = yield* RunControl;
    const admission = yield* RunAdmission;
    const outbox = yield* ThreadSettlementOutbox;
    const changes = yield* ThreadChanges;
    const residency = yield* ThreadResidency;
    const lease = yield* ThreadLeaseRhythm;
    const catalogs = yield* Effect.serviceOption(ModelRuns);
    const progress = yield* Effect.serviceOption(RunProgress);

    const stateOf = (row: ThreadRunRow | null): RunState => {
      if (row === null) return 'absent';
      if (row.status !== 'running') return 'ended';
      if (row.progress.stage === THREAD_RUN_AWAITING_QUESTION_STAGE) return 'parked';
      return row.ownerId === ownerId ? 'running' : 'foreign';
    };

    const breakable = (state: RunState) => state === 'running' || state === 'parked';

    const alive = (row: ThreadRunRow, now: number) => row.handedOverAt === null && row.heartbeatAt.getTime() > now - lease.takeoverAfterMs;

    const ownerAsked = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      intent: ThreadRunStopIntent,
    ): Effect.fn.Return<'requested' | null, ThreadPortFailure> {
      const standing = yield* runs.runById(run.id);
      const state = stateOf(standing);
      if (standing === null || (state !== 'foreign' && state !== 'parked') || !alive(standing, yield* Clock.currentTimeMillis)) return null;
      if ((yield* runs.requestStop(run.id, intent, new Date(yield* Clock.currentTimeMillis))) === null) return null;
      return state === 'foreign' ? ('requested' as const) : null;
    });

    const ownerDrained = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      intent: ThreadRunStopIntent,
    ): Effect.fn.Return<RunStopped | null, ThreadPortFailure> {
      const standing = yield* runs.runById(run.id);
      const state = stateOf(standing);
      if (standing === null || (state !== 'foreign' && state !== 'parked') || !alive(standing, yield* Clock.currentTimeMillis)) return null;
      if ((yield* runs.requestStop(run.id, intent, new Date(yield* Clock.currentTimeMillis))) === null) return null;
      const ceiling = (yield* Clock.currentTimeMillis) + Math.max(lease.takeoverAfterMs, lease.staleRunningAfterMs);
      for (let first = true; ; first = false) {
        if (!first) yield* Effect.sleep(Math.max(10, Math.min(1_000, lease.heartbeatIntervalMs / 4)));
        const row = yield* runs.runById(run.id);
        if (row === null || row.status !== 'running') {
          return row !== null && (row.status === 'aborted' || row.status === 'withdrawn') ? ('stopped' as const) : ('not-running' as const);
        }
        if (stateOf(row) === 'parked') return null;
        const now = yield* Clock.currentTimeMillis;
        if (!alive(row, now) || now >= ceiling) return null;
      }
    });

    const refused = (runId: string, act: RunAct, state: RunState) => Effect.fail(new RunActRefused({ runId, act, state }));

    const stopPatch = (intent: ThreadRunStopIntent) =>
      Effect.map(Clock.currentTimeMillis, (now) => ({
        intent,
        progress: { stage: 'aborted', message: 'Thread run stopped.' } satisfies import('../../rows').ThreadRunProgress,
        finishedAt: new Date(now),
        heartbeatAt: new Date(now),
      }));

    const abortedShape = {
      interruption: (settled: ThreadRunRow) => (settled.stopRequest?.marker ? ('steers' as const) : null),
      ending: (
        settled: ThreadRunRow,
        thread: Parameters<typeof withdrawnTurn>[1],
        ofRun: Parameters<typeof withdrawnTurn>[2],
        unread: number,
      ) => (settled.status === 'aborted' && settled.stopRequest?.withdraw && unread === 0 ? withdrawnTurn(settled, thread, ofRun) : []),
    };

    type Settled = { readonly failure: string | null } | null;

    const announce = Effect.fnUntraced(function* (
      settled: ThreadRunRow,
      noted: Settled,
      delivery: 'awaited' | 'woken',
    ): Effect.fn.Return<void> {
      sequences.forget(settled.id);
      going.ended(settled.id);
      yield* residency.ended(settled.id);
      if (catalogs._tag === 'Some') yield* catalogs.value.release(settled.id);
      if (noted !== null && (settled.status === 'aborted' || settled.status === 'withdrawn' || settled.status === 'failed')) {
        yield* note<RunNote>({ type: 'settled', outcome: settled.status, failure: noted.failure ?? undefined }, { run: settled.id });
      }
      const event = settledEvent(settled);
      yield* delivery === 'awaited' ? outbox.publish(event, settled.settledNotification) : outbox.wake(event, settled.settledNotification);
      if (progress._tag === 'Some') yield* progress.value.end(settled.id);
    });

    const closed = (
      run: ThreadRunRef,
      end: EndPlan,
      noted: Settled,
      tx?: ThreadWriteTx,
    ): Effect.Effect<EndAnswer | null, ThreadPortFailure> =>
      tx === undefined
        ? Effect.gen(function* () {
            const answer = yield* closing.close(run, end);
            if (answer !== null && 'committed' in answer) yield* announce(answer.committed, noted, 'awaited');
            return answer;
          }).pipe(Effect.ensuring(changes.publish(run.threadId)))
        : Effect.gen(function* () {
            const answer = yield* closing.closeIn(run, end, tx);
            if (answer !== null && 'committed' in answer) {
              yield* tx.afterCommit(Effect.andThen(announce(answer.committed, noted, 'woken'), changes.publish(run.threadId)));
            }
            return answer;
          });

    const requestOf = (row: ThreadRunRow): ThreadRunStopRequest | null => {
      const asked = going.intent(row.id);
      return asked === undefined ? row.stopRequest : mergedStopRequest(row.stopRequest, asked, new Date(asked.at));
    };

    const stopping = (row: ThreadRunRow | null) => row !== null && requestOf(row) !== null;

    const abortedClose = (run: ThreadRunRef, intent: ThreadRunStopIntent): EndAct => ({
      write: (tx) =>
        Effect.flatMap(stopPatch(intent), (patch) => {
          const asked = going.intent(run.id);
          return runs.stopRun(
            run.id,
            asked === undefined ? patch : { ...patch, intent: mergedStopRequest(asked, intent, patch.finishedAt) },
            tx,
          );
        }),
      key: endKey(run.id, 'aborted'),
      ...abortedShape,
    });

    const stopNow = (run: ThreadRunRef, intent: ThreadRunStopIntent, tx?: ThreadWriteTx) =>
      closed(run, { ...abortedClose(run, intent), mark: () => IDLE_THREAD }, { failure: null }, tx);

    const displacedClose = (run: ThreadRunRef): EndAct => ({
      ...abortedClose(run, DISPLACED),
      ending: (settled, thread, ofRun, unread) =>
        settled.status === 'aborted' && unread === 0 ? displacedTurn(settled, thread, ofRun) : [],
    });

    const seatedFor = (threadId: string, runId: string): Effect.Effect<void> =>
      Effect.andThen(
        residency.bind(threadId, runId),
        Effect.flatMap(Effect.exit(runs.runById(runId)), (row) =>
          Exit.isSuccess(row) && row.value?.status !== 'running' ? residency.ended(runId) : Effect.void,
        ),
      );

    const ended = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      act: RunAct,
      tx: ThreadWriteTx | undefined,
    ): Effect.fn.Return<'not-running', ThreadPortFailure> {
      const state = stateOf(yield* runs.runById(run.id, tx));
      if (state !== 'ended') return yield* refused(run.id, act, state);
      yield* residency.ended(run.id);
      return 'not-running' as const;
    });

    const completed = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      tx: ThreadWriteTx | undefined,
      unsettled?: string,
    ): Effect.fn.Return<RunEnd, ThreadPortFailure> {
      const row = yield* runs.runById(run.id, tx);
      const answer = yield* closed(
        run,
        {
          write: Effect.fnUntraced(function* (unit) {
            const standing = yield* runs.runById(run.id, unit);
            if (stateOf(standing) !== 'running') return null;
            const now = new Date(yield* Clock.currentTimeMillis);
            if (!stopping(standing))
              return yield* runs.settleRun(
                run.id,
                {
                  status: 'completed',
                  progress: { stage: 'completed', message: 'Thread run completed.' },
                  finishedAt: now,
                  heartbeatAt: now,
                },
                unit,
              );
            const request = requestOf(standing!)!;
            return yield* runs.settleRun(
              run.id,
              { status: 'aborted', settledBy: request.by, stopRequest: request, progress: LATE_STOP, finishedAt: now, heartbeatAt: now },
              unit,
            );
          }),
          key: endKey(run.id, stateOf(row) === 'running' && stopping(row) ? 'aborted' : 'completed'),
          mark: () => IDLE_THREAD,
          unsettled: unsettled,
          answered: true,
          interruption: (settled) => (settled.status === 'aborted' ? abortedShape.interruption(settled) : null),
          ending: abortedShape.ending,
        },
        { failure: null },
        tx,
      );
      if (answer === null) return yield* ended(run, 'finish', tx);
      return 'committed' in answer ? ('committed' as const) : ('replayed' as const);
    });

    const broke = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      cause: Cause.Cause<unknown>,
      departing: boolean,
      returnsWords: true | undefined,
      tx: ThreadWriteTx | undefined,
    ): Effect.fn.Return<RunEnd, ThreadPortFailure> {
      const standing = yield* runs.runById(run.id, tx);
      if (!breakable(stateOf(standing))) return yield* ended(run, 'finish', tx);
      if (departing && !stopping(standing)) return 'left' as const;
      const error = threadCauseOf(Cause.squash(cause));
      const projected = threadFailure(standing!, error);
      const answer = yield* closed(
        run,
        (unit) =>
          Effect.map(runs.runById(run.id, unit), (row): EndAct => ({
            write: Effect.fnUntraced(function* (tx) {
              if (!breakable(stateOf(row))) return null;
              const request = requestOf(row!);
              return yield* runs.settleRun(
                run.id,
                request === null
                  ? {
                      status: 'failed',
                      failureReason: projected.message,
                      failure: projected.diagnostics,
                      progress: { stage: 'failed', message: projected.message },
                      finishedAt: new Date(yield* Clock.currentTimeMillis),
                      heartbeatAt: new Date(yield* Clock.currentTimeMillis),
                    }
                  : {
                      status: 'aborted',
                      settledBy: request.by,
                      stopRequest: request,
                      failureReason: error instanceof ThreadTailLostError ? projected.message : undefined,
                      failure: error instanceof ThreadTailLostError ? projected.diagnostics : undefined,
                      progress: { stage: 'aborted', message: 'Thread run stopped.' },
                      finishedAt: new Date(yield* Clock.currentTimeMillis),
                      heartbeatAt: new Date(yield* Clock.currentTimeMillis),
                    },
                tx,
              );
            }),
            key: endKey(run.id, stopping(row) ? 'aborted' : 'failed'),
            mark: () => IDLE_THREAD,
            returnsWords: returnsWords,
            interruption: abortedShape.interruption,
            ending: (settled, thread, ofRun, unread) =>
              settled.status === 'failed' ? [threadFailureEvent(settled, error)] : abortedShape.ending(settled, thread, ofRun, unread),
          })),
        { failure: describeErrors(Cause.prettyErrors(cause)) },
        tx,
      );
      if (answer === null) return yield* ended(run, 'finish', tx);
      return 'committed' in answer ? ('committed' as const) : ('replayed' as const);
    });

    const claimed = Effect.fnUntraced(function* (
      candidate: ThreadAbandonedRun,
      act: RunAct,
      answer: EndAnswer | null,
    ): Effect.fn.Return<RunClaim, ThreadPortFailure> {
      if (answer !== null) return 'committed' in answer ? ('committed' as const) : ('replayed' as const);
      const state = stateOf(yield* runs.runById(candidate.id));
      return state === 'ended' || state === 'running' || state === 'foreign' ? ('lost' as const) : yield* refused(candidate.id, act, state);
    });

    const opened = (startFrom: ThreadRunStartFrom, approval: AgentApproval, creation: RunCreation) =>
      runs.createRun(
        {
          startFrom,
          kind: creation.kind,
          approval,
          progress: { stage: 'starting', message: 'Thread run started.' },
          startKey: creation.startKey,
          runId: creation.runId,
          origin: creation.origin,
        },
        creation.tx,
      );

    return RunLifecycle.of({
      create: Effect.fnUntraced(function* (startFrom, approval, creation) {
        const startKey = creation.startKey;
        const replaying = startKey !== undefined && (yield* runs.runByStartKey(startFrom.id, startKey.key, creation.tx)) !== null;
        if (!replaying && !admission.admits(startFrom.id)) {
          return yield* Effect.fail(new ThreadRunHeldError({ threadId: startFrom.id }));
        }
        const start = yield* opened(startFrom, approval, creation);
        if (start.run.status === 'running' && catalogs._tag === 'Some') {
          const admitted = Effect.sync(() => catalogs.value.admit(start.run.id));
          yield* creation.tx === undefined ? admitted : creation.tx.afterCommit(admitted);
        }
        if (start.run.kind !== 'compaction') {
          const bound =
            start._tag === 'Started' || start.run.status === 'running'
              ? seatedFor(start.run.threadId, start.run.id)
              : residency.release(start.run.threadId);
          yield* creation.tx === undefined ? bound : creation.tx.afterCommit(bound);
        }
        return start;
      }),

      observe: Effect.fnUntraced(function* (opening) {
        const { tx, startFrom } = opening;
        const displaced = opening.displaces === null ? null : { id: opening.displaces, threadId: startFrom.id };
        const plan: TransitionPlan<ObservedRuns, ThreadWriteTx, ThreadPortFailure> = {
          declared: [],
          decide: Effect.fnUntraced(function* (view, unit) {
            const ended = displaced === null ? null : yield* closing.decideEnd(displaced, displacedClose(displaced), view, unit);
            const started = yield* opened(startFrom, opening.approval, {
              kind: 'turn',
              runId: opening.runId,
              startKey: opening.startKey,
              origin: 'observed',
              tx: unit,
            });
            const decision: Decision<ObservedRuns, ThreadWriteTx, ThreadPortFailure> = {
              apply: true,
              result: { displaced: ended?.settled ?? null, opened: started.run },
              events: [...(ended?.events ?? []), ...opening.entries],
              participants: ended === null ? undefined : ended.participants,
            };
            return decision;
          }),
        };
        const key = {
          evidence: { decidedBy: `observe:${opening.runId}` },
          digest: actDigest(['observe', opening.runId, opening.displaces]),
        };
        const prepared = yield* prepareTransition(kernel, startFrom.id, [], tx);
        const observed = yield* answerOf(startFrom.id, yield* transitionIn(kernel, tx, prepared, plan, key));
        if (observed.opened.status === 'running' && catalogs._tag === 'Some') {
          yield* tx.afterCommit(Effect.sync(() => catalogs.value.admit(observed.opened.id)));
        }
        const changed = changes.publish(startFrom.id);
        const ending =
          observed.displaced === null ? changed : Effect.andThen(announce(observed.displaced, { failure: null }, 'woken'), changed);
        yield* tx.afterCommit(Effect.andThen(seatedFor(observed.opened.threadId, observed.opened.id), ending));
        return observed;
      }),

      resume: Effect.fnUntraced(function* (threadId, runId, awaiting = false) {
        const resumed = yield* runs.resumeAwaitingRun({
          threadId,
          runId,
          progress: awaiting ? ROUTED_AWAITING : { stage: THREAD_RUN_RESUMING_STAGE, message: 'Resuming the thread run.' },
          heartbeatAt: new Date(yield* Clock.currentTimeMillis),
        });
        if (resumed === 'resumed') return;
        yield* stopNow({ id: runId, threadId }, UNSPOKEN);
        return yield* refused(runId, 'resume', 'stopped');
      }),

      park: Effect.fnUntraced(function* (run) {
        const parked = yield* runs.parkRun(
          run.id,
          { stage: THREAD_RUN_AWAITING_QUESTION_STAGE, message: 'Waiting for an answer.' },
          new Date(yield* Clock.currentTimeMillis),
        );
        if (parked === 'parked') return 'parked' as const;
        if (parked === 'gone') return yield* refused(run.id, 'park', stateOf(yield* runs.runById(run.id)));
        yield* stopNow(run, UNSPOKEN);
        return 'stopped' as const;
      }),

      beat: Effect.fnUntraced(function* (beaten, at) {
        if (beaten.length === 0) return [];
        const threadIds = [...new Set(beaten.map((run) => run.threadId))];
        const runIds = beaten.map((run) => run.id);
        const write = Effect.fnUntraced(function* (tx: ThreadWriteTx) {
          yield* kernel.transitions.opened(threadIds, tx);
          const { written, asked } = yield* runs.writeHeartbeats(runIds, at, tx);
          yield* kernel.transitions.revised(threadIds, tx, (revisions) => {
            const byThread = new Map<string, ThreadRunChange[]>();
            for (const { threadId, ...run } of written) {
              const held = byThread.get(threadId);
              if (held === undefined) byThread.set(threadId, [run]);
              else held.push(run);
            }
            return Effect.forEach(
              threadIds,
              (threadId) => {
                const revision = revisions.get(threadId);
                return revision === undefined
                  ? Effect.void
                  : changes.deliver({ kind: 'ran', threadId, revision, runs: byThread.get(threadId) ?? [] });
              },
              { discard: true },
            );
          });
          return asked;
        });
        if (kernel.store.program !== undefined) {
          const programmed = yield* kernel.store.program(`beat:${at.getTime()}:${runIds.join(',')}`, write);
          if (programmed !== null) return programmed;
        }
        return yield* kernel.store.transaction(write);
      }),

      stop: Effect.fnUntraced(function* (run, intent, live, tx) {
        if (live) {
          const request = yield* runs.requestStop(run.id, intent, new Date(yield* Clock.currentTimeMillis), tx);
          if (request === null) return 'not-running' as const;
          if (stateOf(yield* runs.runById(run.id, tx)) !== 'parked') return 'requested' as const;
          const answer = yield* stopNow(run, intent, tx);
          return answer !== null && 'committed' in answer ? ('stopped' as const) : ('not-running' as const);
        }
        if (tx === undefined) {
          const asked = yield* ownerAsked(run, intent);
          if (asked !== null) return asked;
        }
        const answer = yield* stopNow(run, intent, tx);
        return answer !== null && 'committed' in answer ? ('stopped' as const) : ('not-running' as const);
      }),

      drain: Effect.fnUntraced(function* (run, intent) {
        const drained = yield* ownerDrained(run, intent);
        if (drained !== null) return drained;
        const answer = yield* stopNow(run, intent);
        return answer !== null && 'committed' in answer ? ('stopped' as const) : ('not-running' as const);
      }),

      finish: (run, finish, tx) =>
        finish.kind === 'completed'
          ? completed(run, tx, finish.unsettled)
          : broke(run, finish.cause, finish.departing, finish.returnsWords, tx),

      handover: (runIds, at) => (runIds.length === 0 ? Effect.void : runs.handOverRuns(runIds, at)),

      adopt: Effect.fnUntraced(function* (candidate, progress = { stage: THREAD_RUN_RESUMING_STAGE, message: 'Resuming the thread run.' }) {
        const run = { id: candidate.id, threadId: candidate.threadId };
        const adopting = (stage: ThreadRunStage): EndAct => ({
          write: Effect.fnUntraced(function* (tx) {
            return yield* runs.adoptRun(
              candidate.id,
              {
                selector: candidate.selector,
                maxResumes: candidate.resumeLimit,
                progress: stage,
                heartbeatAt: new Date(yield* Clock.currentTimeMillis),
              },
              tx,
            );
          }),
          key: adoptKey(candidate.id),
        });
        const selector = candidate.selector;
        const answer = yield* closing.close(
          run,
          selector.kind !== 'dropped'
            ? adopting(progress)
            : Effect.fnUntraced(function* (tx: ThreadWriteTx) {
                const stepNumber = yield* readThreadRunStepsTaken(kernel.log, kernel.kinds, run, {}, tx);
                const attempt = ((yield* runs.runById(run.id, tx))?.resumes ?? 0) + 1;
                const occurredAt = new Date(yield* Clock.currentTimeMillis).toISOString();
                return {
                  ...adopting({ ...progress, halt: driverHalt(selector.failure, attempt, candidate.resumeLimit) }),
                  ending: (adopted: ThreadRunRow) => [
                    threadEntryEvent({
                      type: 'retry',
                      id: recoveryEntryId(run.id, occurredAt),
                      runId: run.id,
                      stepNumber,
                      attempt: adopted.resumes,
                      of: candidate.resumeLimit,
                      family: 'driver-failed',
                      delayMs: 0,
                      message: selector.failure,
                      occurredAt,
                    }),
                  ],
                };
              }),
        );
        const now = answer !== null && 'committed' in answer ? answer.committed : yield* runs.runById(candidate.id);
        if (answer !== null && ('committed' in answer || (now?.status === 'running' && now.ownerId === ownerId))) {
          if (catalogs._tag === 'Some') catalogs.value.admit(candidate.id);
          yield* note<RunNote>({ type: 'adopted', afterMs: candidate.gapMs }, { run: candidate.id });
          yield* seatedFor(candidate.threadId, candidate.id);
          return { adopted: now! };
        }
        if (now?.status === 'running' && now.stopRequest !== null && (now.ownerId !== ownerId || selector.kind === 'dropped')) {
          yield* stopNow(run, UNSPOKEN);
          return { refused: 'stopped' } as const;
        }
        const lost = !now || now.status !== 'running' || (now.ownerId === ownerId) !== (candidate.selector.kind === 'dropped');
        return candidate.selector.kind !== 'handed-over' && !lost && now.resumes >= candidate.resumeLimit
          ? ({ refused: 'exhausted' } as const)
          : ({ refused: 'ownership-lost' } as const);
      }),

      cut: Effect.fnUntraced(function* (candidate, reason) {
        const answer = yield* closed(
          { id: candidate.id, threadId: candidate.threadId },
          {
            write: Effect.fnUntraced(function* (tx) {
              return yield* runs.cutRun(
                candidate.id,
                {
                  selector: candidate.selector,
                  failureReason: reason,
                  progress: { stage: 'cut', message: reason ?? threadCutSentence(candidate.gapMs) },
                  finishedAt: new Date(yield* Clock.currentTimeMillis),
                },
                tx,
              );
            }),
            key: endKey(candidate.id, 'cut'),
            mark: () => IDLE_THREAD,
            ending: () => [threadCutEvent(candidate.id, candidate.gapMs, reason)],
          },
          null,
        );
        if (answer !== null && 'committed' in answer)
          yield* note<RunNote>({ type: 'cut', afterMs: candidate.gapMs }, { run: candidate.id });
        return yield* claimed(candidate, 'cut', answer);
      }),

      reap: Effect.fnUntraced(function* (candidate, reason, live) {
        if (candidate.selector.kind !== 'stale-heartbeat') return yield* refused(candidate.id, 'reap', 'foreign');
        if (live) {
          yield* note<RunNote>({ type: 'reap-declined', afterMs: candidate.gapMs }, { run: candidate.id });
          return yield* refused(candidate.id, 'reap', 'live');
        }
        const projected = threadFailure({ id: candidate.id, threadId: candidate.threadId, provider: null }, new Error(reason));
        const answer = yield* closed(
          { id: candidate.id, threadId: candidate.threadId },
          (unit) =>
            Effect.map(runs.runById(candidate.id, unit), (row): EndAct => ({
              write: Effect.fnUntraced(function* (tx) {
                return yield* runs.reapRun(
                  candidate.id,
                  {
                    selector: candidate.selector,
                    failureReason: reason,
                    failure: projected.diagnostics,
                    progress: { stage: 'failed', message: 'Thread run was interrupted.' },
                    finishedAt: new Date(yield* Clock.currentTimeMillis),
                  },
                  tx,
                );
              }),
              key: endKey(candidate.id, row?.stopRequest ? 'aborted' : 'failed'),
              interruption: (settled) => (settled.status === 'aborted' ? abortedShape.interruption(settled) : 'plain'),
              mark: (settled) =>
                settled.status === 'aborted' ? IDLE_THREAD : { status: 'failed', failureReason: 'Thread run was interrupted.' },
              ending: abortedShape.ending,
            })),
          null,
        );
        if (answer !== null && 'committed' in answer && answer.committed.status === 'failed') {
          yield* note<RunNote>({ type: 'reaped', cause: candidate.selector.kind, reason, afterMs: candidate.gapMs }, { run: candidate.id });
        }
        return yield* claimed(candidate, 'reap', answer);
      }),
    });
  }),
);
