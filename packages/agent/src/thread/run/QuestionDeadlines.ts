import { Cause, Clock, Context, Duration, Effect, Exit, Fiber, FiberSet, Layer } from 'effect';
import type { ThreadBorderFailed } from '../ThreadBorder';

export type QuestionDeadline = {
  readonly runId: string;
  readonly questionId: string;
  readonly withinMs: number;
  readonly askedAt?: string;
};

export class QuestionDeadlines extends Context.Service<
  QuestionDeadlines,
  {
    arm(deadline: QuestionDeadline, due: Effect.Effect<void, ThreadBorderFailed>): void;
    disarm(runId: string, questionId?: string): void;
  }
>()('@runlith/agent/QuestionDeadlines') {}

const keyOf = (runId: string, questionId: string): string => `${runId}\u0000${questionId}`;

export const questionDeadlinesLayer: Layer.Layer<QuestionDeadlines> = Layer.effect(
  QuestionDeadlines,
  Effect.gen(function* () {
    const fibers = yield* FiberSet.make<void, never>();
    const run = yield* FiberSet.runtime(fibers)();
    const armed = new Map<string, Fiber.Fiber<void>>();

    const disarmKey = (key: string): void => {
      const fiber = armed.get(key);
      armed.delete(key);
      if (fiber !== undefined) fiber.interruptUnsafe();
    };

    const service: Context.Service.Shape<typeof QuestionDeadlines> = {
      arm: (deadline, due) => {
        const key = keyOf(deadline.runId, deadline.questionId);
        disarmKey(key);
        const askedAt = deadline.askedAt === undefined ? Number.NaN : Date.parse(deadline.askedAt);
        const waiting = Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) =>
            Effect.sleep(Duration.millis(Number.isFinite(askedAt) ? Math.max(0, askedAt + deadline.withinMs - now) : deadline.withinMs)),
          ),
          Effect.andThen(Effect.sync(() => armed.delete(key))),
          Effect.andThen(Effect.exit(due)),
          Effect.flatMap((exit) =>
            Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
              ? Effect.logWarning('question deadline failed', { question: deadline.questionId, cause: Cause.pretty(exit.cause) })
              : Effect.void,
          ),
        );
        armed.set(key, run(waiting));
      },
      disarm: (runId, questionId) => {
        if (questionId !== undefined) return disarmKey(keyOf(runId, questionId));
        const prefix = `${runId}\u0000`;
        for (const key of [...armed.keys()]) if (key.startsWith(prefix)) disarmKey(key);
      },
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const key of [...armed.keys()]) disarmKey(key);
      }),
    );
    return service;
  }),
);
