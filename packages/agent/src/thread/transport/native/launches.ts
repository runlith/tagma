import { Cause, Context, Deferred, Effect, Exit, Layer } from 'effect';
import { readThreadRunStepsTaken } from '../../events';
import type { ThreadRow, ThreadRunRow } from '../../rows';
import { ThreadCallBroke, type ThreadBorderFailed } from '../../ThreadBorder';
import { transitionDeps } from '../../transition/kernel';
import { RunAssembly } from '../../run/assembly/RunAssembly';
import { LaunchGate } from '../../run/LaunchGate';
import { RunExecution } from '../../run/RunExecution';
import { pendingQuestionFromSteps } from '../../run/ThreadQuestion';
import { driveThreadRun, threadRunUsage } from '../../run/ThreadRunCycle';
import { ThreadSnapshots } from '../../run/ThreadSnapshots';
import type { ThreadStreamQuestionResult } from '../../run/ThreadStreamSink';
import { QuestionIntake, QuestionRelaunch, type Relaunch } from '../../run/scheduler/intake';
export type Launch = {
  readonly fresh: boolean;
  readonly oriented: boolean;
  readonly outputOptional?: boolean;
  readonly questionResult?: ThreadStreamQuestionResult;
  readonly opened?: Deferred.Deferred<void, ThreadBorderFailed>;
};
export type Launches = {
  launch(thread: ThreadRow, run: ThreadRunRow, launch: Launch): Effect.Effect<void, never, QuestionIntake>;
  relaunch: Relaunch;
};
export class NativeLaunches extends Context.Service<NativeLaunches, Launches>()('@runlith/agent/NativeLaunches') {}
export const makeLaunches = Effect.gen(function* () {
  const { store, log, kinds } = yield* transitionDeps;
  const assembly = yield* RunAssembly;
  const execution = yield* RunExecution;
  const snapshots = yield* ThreadSnapshots;
  const gate = yield* LaunchGate;
  const drive = Effect.fnUntraced(function* (thread: ThreadRow, run: ThreadRunRow, launch: Launch, intake: QuestionIntake['Service']) {
    const stop = execution.haltOf(run.id);
    if (stop === undefined)
      return yield* Effect.die(new Error(`Run ${run.id} is not held by this process, so it has no stop to run under.`));
    const transcript = yield* store.entriesOfRun(thread.id, run.id);
    const stepsTaken = launch.fresh ? 0 : yield* readThreadRunStepsTaken(log, kinds, { id: run.id, threadId: thread.id });
    const begun = stepsTaken > 0 || transcript.some((entry) => entry.type === 'context');
    const parts = yield* assembly.native(
      { thread, run, transcript, stepsTaken, stop },
      {
        oriented: launch.oriented && !begun,
        ask: intake.ask,
        opened: launch.opened,
      },
    );
    yield* parts.start(launch.questionResult);
    gate.confirmed(thread.id);
    yield* snapshots.publish(thread.id);
    const handle = parts.handle;
    const tracking = yield* driveThreadRun(execution, {
      run,
      stop: (reason) => handle.stop(reason),
      output: handle.output,
      completedSteps: handle.completedSteps,
      toolOutputs: handle.toolOutputs,
      flush: parts.recorder.stop(),
      onComplete: Effect.fnUntraced(function* ({ text: replyText, steps, usage }) {
        yield* parts.recorder.stop();
        const question = yield* pendingQuestionFromSteps(run, steps, parts.questionForTools);
        const parked = yield* intake.park(run, question, handle.door, handle.untoldGuides());
        return {
          parked,
          hasVisibleOutput:
            launch.outputOptional === true ||
            Boolean(replyText) ||
            question !== null ||
            steps.some((step) => step.toolResults.some((result) => parts.shownTools.has(result.toolName))),
          usage: threadRunUsage(usage),
        };
      }),
      onFinally: () => snapshots.publish(thread.id).pipe(Effect.ensuring(handle.close())),
    });
    tracking.startTracking();
    parts.ready();
    return Effect.flatMap(Effect.result(tracking.done), (result) =>
      result._tag === 'Failure'
        ? Effect.logWarning('the thread run failed', { runId: run.id, threadId: thread.id, failure: result.failure })
        : Effect.void,
    );
  });
  const launch = Effect.fnUntraced(function* (
    thread: ThreadRow,
    run: ThreadRunRow,
    launch: Launch,
  ): Effect.fn.Return<void, never, QuestionIntake> {
    const intake = yield* QuestionIntake;
    yield* execution.launch(
      run,
      Effect.scoped(Effect.flatMap(execution.settling(run, drive(thread, run, launch, intake)), (drain) => drain)).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (launch.opened === undefined) return;
            const failed = Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause);
            Deferred.doneUnsafe(
              launch.opened,
              failed ? Effect.fail(new ThreadCallBroke({ cause: Cause.squash(exit.cause) })) : Effect.void,
            );
          }),
        ),
        Effect.catchCause(
          Effect.fnUntraced(function* (cause) {
            if (!Cause.hasInterruptsOnly(cause)) {
              yield* Effect.logWarning('run opening failed', { runId: run.id, threadId: thread.id, reason: Cause.pretty(cause) });
            }
            yield* snapshots.publish(thread.id).pipe(Effect.ignore);
          }),
        ),
      ),
    );
  });
  return NativeLaunches.of({
    launch,
    relaunch: (thread, run, questionResult) => launch(thread, run, { fresh: false, oriented: false, questionResult }),
  });
});

export const nativeLaunchesLayer = Layer.effectContext(
  Effect.map(makeLaunches, (launches) =>
    Context.make(NativeLaunches, launches).pipe(Context.add(QuestionRelaunch, QuestionRelaunch.of({ relaunch: launches.relaunch }))),
  ),
);
