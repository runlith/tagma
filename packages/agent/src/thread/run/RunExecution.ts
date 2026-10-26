import { Cause, Clock, Context, Deferred, Duration, Effect, Exit, Fiber, FiberMap, FiberSet, Layer, Option, type Scope } from 'effect';
import { waiters } from '@runlith/held/Waiters';
import { note } from '@runlith/activity/Activity';
import type { AgentApproval, AgentApprovalMode } from '../../agent/contracts';
import type { ThreadRunStoppedBy } from '../ending';
import { ModeLaw } from '../../modes/ModeLaw';
import { RunStop } from '../../agent/RunStop';
import type { ThreadRunRow } from '../rows';
import type { ThreadRunStart, ThreadRunStartFrom, ThreadRunStartKey, ThreadRunStopIntent } from '../storage/runs';
import { THREAD_RUN_AWAITING_QUESTION_STAGE, ThreadRunHeldError } from '../storage/runs';
import { type ThreadBorderFailed, type ThreadPortFailure, threadCauseOf } from '../ThreadBorder';
import { ApprovalParking } from './ApprovalParking';
import { type RunEnd, RunLifecycle, type RunStopped } from './lifecycle/RunLifecycle';
import { RunControl } from './RunControl';
import type { RunNote } from './notes';
import type { InterruptReceipt } from '../transport/contract';
import { RunAdmission } from './runAdmission';
import { RunBoundaries, runBoundariesLayer } from './RunBoundaries';
import { RunSweep } from '../ThreadPorts';
import { ThreadRunInbox } from './ThreadRunInbox';
import { ThreadRunLedger, type ThreadRunRef } from './ThreadRunLedger';
import { ThreadRunSettlements } from './ThreadRunSettlements';
export class ThreadRunStopped extends Error {
  constructor(readonly by: ThreadRunStoppedBy | null) {
    super('Thread run stopped by user.');
    this.name = 'ThreadRunStopped';
  }
}
export type ThreadRunTracking = {
  startTracking(): void;
  done: Effect.Effect<void, ThreadBorderFailed>;
};
export type RunStopping = {
  readonly by?: ThreadRunStoppedBy;
  readonly marker?: boolean;
  readonly withdraw?: boolean;
  readonly awaitSettled?: boolean;
  readonly within?: Duration.Duration;
  readonly at?: 'step';
  readonly key?: string;
};
export type RunTracked = {
  readonly work: Effect.Effect<void, ThreadBorderFailed>;
  readonly stop?: (reason: unknown) => Effect.Effect<void>;
  readonly drain?: Effect.Effect<void, ThreadBorderFailed>;
  readonly unworked?: Effect.Effect<void, ThreadBorderFailed>;
};
export type RunResumption = {
  readonly halt: RunStop;
  readonly interruptible: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
};
export class RunExecution extends Context.Service<
  RunExecution,
  {
    create(
      startFrom: ThreadRunStartFrom,
      approval: AgentApproval,
      startKey?: ThreadRunStartKey,
    ): Effect.Effect<ThreadRunStart, ThreadPortFailure>;
    open(run: ThreadRunRow, mode: AgentApprovalMode): Effect.Effect<void, ThreadPortFailure>;
    enlist(run: ThreadRunRef, mode: AgentApprovalMode): Effect.Effect<void>;
    confirm(run: ThreadRunRef): Effect.Effect<void, ThreadPortFailure>;
    resumeParked(threadId: string, runId: string): Effect.Effect<void, ThreadPortFailure>;
    resume<A, R>(
      run: ThreadRunRef,
      work: (resumption: RunResumption) => Effect.Effect<A, ThreadBorderFailed, R>,
    ): Effect.Effect<A, ThreadBorderFailed, R>;
    adopted(run: ThreadRunRef): Effect.Effect<void, ThreadPortFailure>;
    track(run: ThreadRunRef, input: RunTracked): Effect.Effect<ThreadRunTracking>;
    launch(run: ThreadRunRef, work: Effect.Effect<void>): Effect.Effect<void>;
    complete(run: ThreadRunRef): Effect.Effect<RunEnd, ThreadPortFailure>;
    settle(run: ThreadRunRef, cause: Cause.Cause<unknown>): Effect.Effect<RunEnd, ThreadPortFailure>;
    settling<A, E, R>(run: ThreadRunRef, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
    stop(run: ThreadRunRef, stopping?: RunStopping): Effect.Effect<RunStopped | 'still-settling', ThreadBorderFailed>;
    checkpoint(run: ThreadRunRef): Effect.Effect<void, ThreadBorderFailed>;
    settled(runId: string): Effect.Effect<void>;
    drained(runId: string): Effect.Effect<void>;
    driven(threadIds: readonly string[]): readonly ThreadRunRef[];
    holds(runId: string): boolean;
    halted(runId: string): boolean;
    haltOf(runId: string): RunStop | undefined;
    abort(runId: string, reason: unknown): Effect.Effect<InterruptReceipt>;
  }
>()('@runlith/agent/RunExecution') {}
type RunHold = {
  readonly halt: RunStop;
  readonly openers: Set<Fiber.Fiber<unknown, unknown>>;
  stop?: (reason: unknown) => Effect.Effect<void>;
  begin?: () => void;
  began: boolean;
};
const freshHold = (): RunHold => ({ halt: new RunStop(), openers: new Set(), began: false });
type OpeningWork = {
  readonly run: ThreadRunRef;
  readonly fibers: Set<Fiber.Fiber<unknown, unknown>>;
};
type StartingRun = {
  readonly hold: RunHold;
  readonly resuming: boolean;
  readonly ticket: string;
  left: boolean;
};
type Boundary = {
  readonly stopping: RunStopping;
  readonly hit: Deferred.Deferred<void>;
  reached: boolean;
  users: number;
};
const STOPPED_BEFORE_START = 'Thread run was stopped before it started.';
export const runExecutionLayer = Layer.effect(
  RunExecution,
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<string, void, ThreadBorderFailed>();
    const openers = yield* FiberSet.make<void | Exit.Exit<void, ThreadBorderFailed>, never>();
    const started = yield* waiters<string, void, never>({
      name: 'run starts tracked',
      owner: '@runlith/agent/RunExecution',
      key: (id) => id,
    });
    const resumed = yield* waiters<string, void, never>({
      name: 'resumed runs settled',
      owner: '@runlith/agent/RunExecution',
      key: (id) => id,
    });
    const ended = yield* waiters<string, void, never>({
      name: 'step-boundary stops',
      owner: '@runlith/agent/RunExecution',
      key: (id) => id,
    });
    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'step-boundary stops',
      handle: (event) => Effect.sync(() => ended.complete(event.runId, Exit.void)),
    });
    const lifecycle = yield* RunLifecycle;
    const control = yield* RunControl;
    const ledger = yield* ThreadRunLedger;
    const inbox = yield* ThreadRunInbox;
    const parking = yield* ApprovalParking;
    const laws = yield* ModeLaw;
    const admission = yield* RunAdmission;
    const sweeping = yield* RunSweep;
    const sweeps = yield* FiberSet.make<void, never>();
    const sweep = (run: ThreadRunRef): Effect.Effect<void> =>
      sweeping === null
        ? Effect.void
        : Effect.asVoid(
            FiberSet.run(
              sweeps,
              Effect.flatMap(Effect.exit(sweeping.sweep(run.threadId, run.id)), (swept) =>
                Effect.asVoid(
                  note<RunNote>(Exit.isSuccess(swept) ? { type: 'swept' } : { type: 'swept', failure: Cause.pretty(swept.cause) }, {
                    run: run.id,
                  }),
                ),
              ),
            ),
          );
    const reported = yield* RunBoundaries;
    const running = new Map<string, RunHold>();
    const driving = new Map<string, ThreadRunRef>();
    const opening = new Map<string, OpeningWork>();
    const startingRuns = new Map<string, StartingRun>();
    const stoppedStarts = new Map<string, RunHold>();
    const departing = new Set<string>();
    const boundaries = new Map<string, Boundary>();
    let closing = false;
    let tickets = 0;
    const holdOf = (runId: string): RunHold | undefined => startingRuns.get(runId)?.hold ?? running.get(runId) ?? stoppedStarts.get(runId);
    const leave = (starting: StartingRun): void => {
      starting.left = true;
      started.complete(starting.ticket, Exit.void);
    };
    const releaseStart = (runId: string): void => {
      const starting = startingRuns.get(runId);
      if (!starting) return;
      startingRuns.delete(runId);
      if (starting.hold.halt.stopped) stoppedStarts.set(runId, starting.hold);
      leave(starting);
    };
    const takeOver = (runId: string): RunHold => {
      const starting = startingRuns.get(runId);
      startingRuns.delete(runId);
      const hold = starting?.hold ?? stoppedStarts.get(runId) ?? freshHold();
      stoppedStarts.delete(runId);
      hold.openers.clear();
      running.set(runId, hold);
      if (starting) leave(starting);
      return hold;
    };
    const letGo = (runId: string): void => {
      releaseStart(runId);
      inbox.forget(runId);
      parking.release(runId);
    };
    const admit = (threadId: string): Effect.Effect<void, ThreadPortFailure> =>
      Effect.suspend(() => (admission.admits(threadId) ? Effect.void : Effect.fail(new ThreadRunHeldError({ threadId }))));
    const enlistStart = (runId: string, resuming: boolean): void => {
      tickets += 1;
      stoppedStarts.delete(runId);
      startingRuns.set(runId, { hold: freshHold(), resuming, ticket: `${runId}#${tickets}`, left: false });
      inbox.signalQueue(runId);
    };
    const confirmStart = (runId: string): Effect.Effect<void, ThreadPortFailure> =>
      Effect.suspend(() => {
        const hold = startingRuns.get(runId)?.hold;
        return Effect.gen(function* () {
          const stillRunning = yield* ledger.isRunning(runId);
          if (stillRunning && hold?.halt.stopped !== true) return;
          return yield* Effect.die(hold?.halt.stopped === true ? hold.halt.reason : new Error(STOPPED_BEFORE_START));
        }).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isSuccess(exit)) return;
              hold?.halt.stop(threadCauseOf(Cause.squash(exit.cause)));
              if (startingRuns.get(runId)?.hold === hold) releaseStart(runId);
              stoppedStarts.delete(runId);
              inbox.forget(runId);
            }),
          ),
        );
      });
    const registerStart = (runId: string, resuming = false): Effect.Effect<void, ThreadPortFailure> =>
      Effect.suspend(() => {
        enlistStart(runId, resuming);
        return confirmStart(runId);
      });
    const reserveAnswer = (threadId: string, runId: string, resuming: boolean): Effect.Effect<void, ThreadPortFailure> =>
      Effect.suspend(() => {
        if (closing) return Effect.die(new Error('The agent harness has been disposed.'));
        return Effect.gen(function* () {
          yield* admit(threadId);
          yield* lifecycle.resume(threadId, runId);
          yield* registerStart(runId, resuming);
        });
      });
    const opened = (run: ThreadRunRef, fiber: Fiber.Fiber<unknown, unknown>): void => {
      if (fiber.pollUnsafe() !== undefined) return;
      const pending = opening.get(run.id) ?? { run, fibers: new Set<Fiber.Fiber<unknown, unknown>>() };
      pending.fibers.add(fiber);
      opening.set(run.id, pending);
      fiber.addObserver(() => {
        pending.fibers.delete(fiber);
        if (pending.fibers.size === 0 && opening.get(run.id) === pending) opening.delete(run.id);
      });
      const hold = startingRuns.get(run.id)?.hold;
      if (hold === undefined) return;
      if (hold.halt.stopped) {
        fiber.interruptUnsafe();
        return;
      }
      hold.openers.add(fiber);
      fiber.addObserver(() => hold.openers.delete(fiber));
    };
    const stopped = (runId: string, hold: RunHold, reason: unknown): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (!hold.halt.stop(reason)) return Effect.void;
        for (const fiber of hold.openers) fiber.interruptUnsafe();
        hold.openers.clear();
        const working = hold.began;
        hold.begin?.();
        if (hold.stop !== undefined) return hold.stop(reason);
        const tracked = working && running.get(runId) === hold ? FiberMap.getUnsafe(fibers, runId) : Option.none();
        if (Option.isSome(tracked)) tracked.value.interruptUnsafe();
        return Effect.void;
      });
    const settled = (runId: string): Effect.Effect<void> => {
      const fiber = FiberMap.getUnsafe(fibers, runId);
      return Option.isSome(fiber) ? Effect.asVoid(Fiber.await(fiber.value)) : Effect.void;
    };
    const settle = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      cause: Cause.Cause<unknown>,
    ): Effect.fn.Return<RunEnd, ThreadPortFailure> {
      letGo(run.id);
      const leaving = departing.delete(run.id);
      if (leaving) {
        running.delete(run.id);
        yield* note<RunNote>({ type: 'host-stopping' }, { run: run.id });
      }
      return yield* lifecycle.finish(run, { kind: 'broke', cause, departing: leaving });
    });
    const settling = <A, E, R>(run: ThreadRunRef, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      work.pipe(
        Effect.onError((cause) =>
          settle(run, cause).pipe(
            Effect.catchCause((failure) =>
              Effect.logWarning('a thread run could not be settled', {
                runId: run.id,
                threadId: run.threadId,
                cause: Cause.pretty(failure),
              }),
            ),
          ),
        ),
      );
    const awaitWithin = Effect.fnUntraced(function* (settled: Effect.Effect<unknown>, within: Duration.Duration | undefined) {
      if (within === undefined) {
        yield* settled;
        return true;
      }
      return Option.isSome(yield* Effect.timeoutOption(settled, within));
    });
    const boundInterrupt = (run: ThreadRunRef, by: ThreadRunStoppedBy | null): Effect.Effect<void> =>
      Effect.flatMap(Effect.exit(control.interrupt(run, by)), (told) =>
        Exit.isFailure(told)
          ? Effect.logWarning('the transport of a stopped run nobody held was not told', {
              runId: run.id,
              cause: Cause.pretty(told.cause),
            })
          : Effect.void,
      );
    const unheld = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      stopping: RunStopping,
      intent: ThreadRunStopIntent,
    ): Effect.fn.Return<RunStopped, ThreadPortFailure> {
      letGo(run.id);
      const answer = stopping.awaitSettled ? yield* lifecycle.drain(run, intent) : yield* lifecycle.stop(run, intent, false);
      if (answer === 'stopped') yield* boundInterrupt(run, intent.by);
      return answer;
    });
    const held = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      stopping: RunStopping,
      intent: ThreadRunStopIntent,
    ): Effect.fn.Return<RunStopped | 'still-settling', ThreadPortFailure, Scope.Scope> {
      const starting = startingRuns.get(run.id);
      const native = running.has(run.id);
      const watched =
        !stopping.awaitSettled || native
          ? null
          : starting === undefined
            ? yield* ended.watch([run.id])
            : starting.resuming
              ? yield* resumed.watch([starting.ticket])
              : null;
      control.intend(run.id, intent, new Date(yield* Clock.currentTimeMillis));
      const [interrupted, asked] = yield* Effect.all(
        [Effect.exit(control.interrupt(run, intent.by)), Effect.exit(lifecycle.stop(run, intent, true))],
        { concurrency: 'unbounded' },
      );
      if (starting !== undefined) releaseStart(run.id);
      if (Exit.isFailure(asked)) {
        if (starting !== undefined) letGo(run.id);
        return yield* Effect.failCause(asked.cause);
      }
      if (Exit.isFailure(interrupted)) return yield* Effect.failCause(interrupted.cause);
      if (asked.value === 'not-running' && interrupted.value === 'no-turn') return 'not-running' as const;
      if (starting !== undefined || interrupted.value === 'no-turn') {
        letGo(run.id);
        yield* lifecycle.stop(run, intent, false);
      }
      if (!stopping.awaitSettled) return 'stopped' as const;
      const fiber = native ? FiberMap.getUnsafe(fibers, run.id) : Option.none();
      const settled = Option.isSome(fiber) ? Fiber.await(fiber.value) : watched;
      if (settled !== null && !(yield* awaitWithin(settled, stopping.within))) return 'still-settling' as const;
      return 'stopped' as const;
    });
    const halt = (run: ThreadRunRef, stopping: RunStopping): Effect.Effect<RunStopped | 'still-settling', ThreadPortFailure> =>
      Effect.suspend(() => {
        const intent: ThreadRunStopIntent = {
          by: stopping.by ?? null,
          marker: stopping.marker ?? false,
          withdraw: stopping.withdraw ?? false,
          key: stopping.key,
        };
        return control.holder(run.id) !== undefined ? Effect.scoped(held(run, stopping, intent)) : unheld(run, stopping, intent);
      });
    const atBoundary = (stopping: RunStopping): RunStopping => ({ ...stopping, marker: false, awaitSettled: false });
    const boundaryReached = (runId: string): Boundary | null => {
      const asked = boundaries.get(runId);
      if (asked === undefined) return null;
      boundaries.delete(runId);
      reported.forget(runId, asked.hit);
      asked.reached = true;
      return asked;
    };
    const shutdown = Effect.fnUntraced(function* () {
      closing = true;
      const disposed = new Error(
        'The agent host is shutting down. In-flight tool calls were interrupted; their effects may already have completed. Check the recorded outcome and current state before retrying.',
      );
      for (const runId of [...startingRuns.keys(), ...running.keys()]) {
        yield* note<RunNote>({ type: 'host-stopping' }, { run: runId });
      }
      const holds = [...startingRuns.entries()].map(([runId, start]) => [runId, start.hold] as const).concat([...running.entries()]);
      const driven = [...new Set(holds.filter(([, hold]) => !hold.halt.stopped).map(([runId]) => runId))];
      for (const runId of driven) departing.add(runId);
      startingRuns.clear();
      stoppedStarts.clear();
      yield* Effect.forEach(holds, ([runId, hold]) => stopped(runId, hold, disposed), { discard: true });
      yield* Effect.exit(FiberMap.awaitEmpty(fibers));
      yield* FiberSet.clear(openers);
      yield* lifecycle
        .handover(driven, new Date(yield* Clock.currentTimeMillis))
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning('departing runs could not be handed over', { runs: driven, cause: Cause.pretty(cause) }),
          ),
        );
    });
    yield* Effect.addFinalizer(() => shutdown());
    const enlist = (run: ThreadRunRef, mode: AgentApprovalMode): Effect.Effect<void> =>
      Effect.sync(() => {
        enlistStart(run.id, false);
        void laws.of(run.threadId, mode);
      });
    const open = (run: ThreadRunRow, mode: AgentApprovalMode): Effect.Effect<void, ThreadPortFailure> =>
      Effect.andThen(enlist(run, mode), confirmStart(run.id));
    return RunExecution.of({
      create: (startFrom, approval, startKey) =>
        Effect.suspend(() => {
          if (closing) return Effect.die(new Error('The agent harness has been disposed.'));
          return Effect.gen(function* () {
            const start = yield* lifecycle.create(startFrom, approval, { kind: 'turn', startKey: startKey });
            if (start._tag === 'Started') yield* open(start.run, approval.mode);
            return start;
          });
        }),
      open,
      enlist,
      confirm: (run) => confirmStart(run.id),
      resumeParked: (threadId, runId) => reserveAnswer(threadId, runId, false),
      resume: <A, R>(run: ThreadRunRef, work: (resumption: RunResumption) => Effect.Effect<A, ThreadBorderFailed, R>) =>
        Effect.uninterruptibleMask(
          Effect.fnUntraced(function* (restore) {
            yield* restore(settled(run.id));
            yield* reserveAnswer(run.threadId, run.id, true);
            const starting = startingRuns.get(run.id);
            const halt = starting?.hold.halt ?? stoppedStarts.get(run.id)?.halt ?? new RunStop();
            const answer = Deferred.makeUnsafe<A, ThreadBorderFailed>();
            const tracked = Effect.suspend(() => (starting === undefined || starting.left ? Effect.void : started.wait(starting.ticket)));
            const owned = Effect.uninterruptibleMask((interruptible) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const value = yield* settling(run, work({ halt, interruptible }));
                  yield* Deferred.succeed(answer, value);
                  if (starting) yield* interruptible(tracked);
                }),
              ),
            ).pipe(Effect.interruptible, Effect.exit);
            const opener = yield* FiberSet.run(openers, owned, { startImmediately: false });
            opener.addObserver((returned) => {
              const outcome = Exit.isSuccess(returned) ? returned.value : returned;
              if (Exit.isFailure(outcome)) Deferred.doneUnsafe(answer, Effect.failCause(outcome.cause));
              if (startingRuns.get(run.id) === starting) releaseStart(run.id);
              if (starting?.resuming) resumed.complete(starting.ticket, Exit.void);
            });
            opened(run, opener);
            return yield* restore(Deferred.await(answer));
          }),
        ),
      adopted: (run) => Effect.andThen(admit(run.threadId), registerStart(run.id)),
      track: Effect.fnUntraced(function* (run, input) {
        const runId = run.id;
        if (closing) return yield* Effect.die(new Error('The agent harness has been disposed.'));
        const began = Deferred.makeUnsafe<void>();
        const hold = takeOver(runId);
        const startTracking = () => {
          if (hold.began) return;
          hold.began = true;
          Deferred.doneUnsafe(began, Effect.void);
        };
        if (input.stop !== undefined) hold.stop = input.stop;
        hold.begin = startTracking;
        if (hold.halt.stopped) startTracking();
        driving.set(runId, { id: runId, threadId: run.threadId });
        const fiber = yield* FiberMap.run(
          fibers,
          runId,
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                const current = running.get(runId);
                if (current !== undefined && current !== hold) return;
                running.delete(runId);
                driving.delete(runId);
                inbox.forget(runId);
                laws.forget(run.threadId);
              }),
            );
            yield* Deferred.await(began);
            if (hold.halt.stopped) {
              const drained = input.drain === undefined ? Exit.void : yield* Effect.exit(input.drain);
              const ended = yield* Effect.exit(settle(run, Exit.isFailure(drained) ? drained.cause : Cause.interrupt()));
              if (input.unworked !== undefined) yield* input.unworked;
              return yield* Effect.asVoid(ended);
            }
            yield* input.work;
          }).pipe(Effect.scoped),
        );
        const done = Fiber.await(fiber).pipe(
          Effect.flatMap((exit) => (Exit.isFailure(exit) && hold.halt.stopped && Cause.hasInterruptsOnly(exit.cause) ? Effect.void : exit)),
        );
        return { startTracking, done };
      }),
      launch: (run, work) =>
        Effect.suspend(() => {
          if (closing) return Effect.die(new Error(`The agent harness has been disposed; run ${run.id} cannot open.`));
          return Effect.map(FiberSet.run(openers, work, { startImmediately: false }), (fiber) => opened(run, fiber));
        }),
      complete: (run) =>
        Effect.suspend(() => {
          letGo(run.id);
          return lifecycle.finish(run, { kind: 'completed' });
        }),
      settle,
      settling,
      stop: Effect.fnUntraced(function* (run, stopping = {}) {
        const active = stopping.at === 'step' ? yield* ledger.activeRun(run.threadId) : null;
        const awaiting = active?.id === run.id && active.progress.stage === THREAD_RUN_AWAITING_QUESTION_STAGE;
        if (stopping.at === 'step' && !awaiting)
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const stepEnded = yield* ended.watch([run.id]);
              if (!(yield* ledger.isRunning(run.id))) return 'not-running' as const;
              if (!(yield* ledger.runningHere([run.id])).includes(run.id)) return 'still-settling' as const;
              const asked = boundaries.get(run.id) ?? {
                stopping: { ...stopping, at: undefined },
                hit: reported.awaiting(run.id),
                reached: false,
                users: 0,
              };
              asked.users += 1;
              boundaries.set(run.id, asked);
              const adapterStep = Effect.andThen(
                Deferred.await(asked.hit),
                Effect.suspend(() => {
                  boundaryReached(run.id);
                  asked.reached = true;
                  return halt(run, atBoundary(asked.stopping));
                }),
              );
              const wait = Effect.andThen(Effect.raceFirst(stepEnded, Effect.andThen(adapterStep, stepEnded)), settled(run.id));
              const waited = yield* (
                stopping.within === undefined
                  ? Effect.as(wait, true)
                  : Effect.map(wait.pipe(Effect.timeoutOption(stopping.within)), Option.isSome)
              ).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    asked.users -= 1;
                    if (asked.users > 0 || boundaries.get(run.id) !== asked) return;
                    boundaries.delete(run.id);
                    reported.forget(run.id, asked.hit);
                  }),
                ),
              );
              if (!waited) return 'still-settling' as const;
              if (!asked.reached) return 'not-running' as const;
              yield* sweep(run);
              return 'stopped' as const;
            }),
          );
        const halted = yield* Effect.exit(halt(run, stopping));
        if (Exit.isSuccess(halted) && halted.value === 'not-running') return halted.value;
        yield* sweep(run);
        if (Exit.isFailure(halted)) return yield* Effect.failCause(halted.cause);
        return halted.value;
      }),
      checkpoint: (run) =>
        Effect.suspend(() => {
          const asked = boundaryReached(run.id);
          return asked === null
            ? Effect.void
            : Effect.andThen(Effect.uninterruptible(halt(run, atBoundary(asked.stopping))), Effect.interrupt);
        }),
      settled,
      drained: (runId) =>
        Effect.suspend(() =>
          Effect.all(
            [settled(runId), Effect.forEach([...(opening.get(runId)?.fibers ?? [])], (fiber) => Fiber.await(fiber), { discard: true })],
            { concurrency: 'unbounded', discard: true },
          ),
        ),
      driven: (threadIds) => {
        const asked = new Set(threadIds);
        const current = new Map([...driving].filter(([id]) => FiberMap.hasUnsafe(fibers, id)));
        for (const [id, pending] of opening) current.set(id, pending.run);
        return [...current.values()].filter((run) => asked.has(run.threadId));
      },
      holds: (runId) => startingRuns.has(runId) || running.has(runId),
      halted: (runId) => holdOf(runId)?.halt.stopped ?? false,
      haltOf: (runId) => holdOf(runId)?.halt,
      abort: (runId, reason) =>
        Effect.suspend(() => {
          const hold = holdOf(runId);
          if (hold === undefined) return Effect.succeed<InterruptReceipt>('no-turn');
          return Effect.andThen(
            stopped(runId, hold, reason),
            Effect.sync((): InterruptReceipt => {
              if (startingRuns.get(runId)?.hold === hold) releaseStart(runId);
              return 'interrupted';
            }),
          );
        }),
    });
  }),
).pipe(Layer.provideMerge(runBoundariesLayer));
