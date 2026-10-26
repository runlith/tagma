import { Cause, type Context, Effect, Exit } from 'effect';
import type { Usage } from '@runlith/llm/schema/events';
import type { AgentStep } from '../../agent/AgentStep';
import type { AgentRunOutput } from '../../agent/AgentRunner';
import type { ThreadRunRow } from '../rows';
import { threadFailureMessage, ThreadNoOutputError, ThreadTailLostError } from '../ThreadFailure';
import { ThreadCallBroke, type ThreadBorderFailed, threadCall, threadCauseOf } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import type { RunParked } from './lifecycle/RunLifecycle';
import type { RunExecution, ThreadRunTracking } from './RunExecution';
import type { ThreadToolOutputScopeFaces } from '../ThreadPorts';

export type ThreadRunProjection = {
  run: ThreadRunRow;
  stop: (reason: unknown) => Effect.Effect<void>;
  output: AgentRunOutput;
  completedSteps(): readonly AgentStep[];
  toolOutputs: ThreadToolOutputScopeFaces;
  flush: Effect.Effect<void, ThreadBorderFailed>;
  onComplete(result: {
    text: string;
    steps: readonly AgentStep[];
    usage: Effect.Success<AgentRunOutput['usage']>;
  }): Effect.Effect<{ parked: RunParked | null; hasVisibleOutput: boolean; usage: Usage | null }, ThreadBorderFailed>;
  onFinally(options: { awaitingFollowup: boolean }): Effect.Effect<void, ThreadBorderFailed>;
};

export function driveThreadRun(
  execution: Context.Service.Shape<typeof RunExecution>,
  projection: ThreadRunProjection,
): Effect.Effect<ThreadRunTracking> {
  return execution.track(projection.run, {
    stop: projection.stop,
    work: runStream(execution, projection),
    drain: Effect.andThen(
      projection.stop(STOPPED_BEFORE_WORK),
      projection.flush.pipe(
        Effect.retry({ times: 1 }),
        Effect.mapError((failure) => new ThreadCallBroke({ cause: new ThreadTailLostError(threadCauseOf(failure)) })),
      ),
    ),
    unworked: closing(projection, false),
  });
}

const STOPPED_BEFORE_WORK = new Error('Thread run stopped before its work began.');

function runStream(
  execution: Context.Service.Shape<typeof RunExecution>,
  projection: ThreadRunProjection,
): Effect.Effect<void, ThreadBorderFailed> {
  const run = projection.run;
  const runId = run.id;
  let completed = false;
  let awaitingFollowup = false;
  const body = Effect.fn('runStream')(function* () {
    const [steps, usage] = yield* Effect.all([projection.output.steps, projection.output.usage]).pipe(
      Effect.mapError((broke) => new ThreadCallBroke({ cause: broke.cause })),
    );
    const text = steps
      .map((step) => step.text.trim())
      .filter(Boolean)
      .join('\n\n');
    const result = yield* projection.onComplete({
      text,
      steps,
      usage,
    });
    completed = true;
    if (result.parked !== null) {
      awaitingFollowup = result.parked === 'parked';
      return;
    }
    if (!result.hasVisibleOutput) return yield* new ThreadCallBroke({ cause: new ThreadNoOutputError(steps) });
    yield* execution.complete(run);
  });
  const settled = Effect.fn('runStream')(function* () {
    const outcome = yield* Effect.exit(body());
    if (Exit.isSuccess(outcome)) return;
    const failure = thrownOf(outcome.cause);
    const tail = completed ? Exit.void : yield* Effect.exit(projection.flush.pipe(Effect.retry({ times: 1 })));
    if (Exit.isFailure(tail)) {
      const lost = new ThreadTailLostError(thrownOf(tail.cause));
      yield* Effect.logWarning('the run ended without its last tail', { runId, failure: threadFailureMessage(failure) });
      yield* execution.settle(run, Cause.fail(lost));
      return yield* new ThreadCallBroke({ cause: lost });
    }
    yield* execution.settle(run, Cause.fail(failure));
    if (execution.halted(runId)) return;
    return yield* new ThreadCallBroke({ cause: failure });
  });
  return Effect.gen(function* () {
    const outcome = yield* Effect.exit(settled());
    yield* closing(projection, awaitingFollowup);
    return yield* outcome;
  });
}

function closing(projection: ThreadRunProjection, awaitingFollowup: boolean): Effect.Effect<void, ThreadBorderFailed> {
  return Effect.andThen(
    projection.toolOutputs.dispose().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning('tool output dispose failed', {
          runId: projection.run.id,
          error: threadFailureMessage(Cause.squash(cause)),
        }),
      ),
    ),
    projection.onFinally({ awaitingFollowup }),
  );
}

function thrownOf(cause: Cause.Cause<ThreadBorderFailed>): unknown {
  const squashed = Cause.squash(cause);
  return squashed instanceof ThreadCallBroke || squashed instanceof ThreadStorageFailed ? squashed.cause : squashed;
}

export function threadRunUsage(usage: Effect.Success<AgentRunOutput['usage']>): Usage | null {
  const counters = [
    usage.inputTokens,
    usage.outputTokens,
    usage.reasoningTokens,
    usage.cacheReadInputTokens,
    usage.cacheWriteInputTokens,
    usage.totalTokens,
  ];
  return counters.every((value) => value === undefined || value <= 0) ? null : usage;
}
