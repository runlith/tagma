import { Cause, Duration, Effect, Fiber, Scope, Semaphore } from 'effect';
import { section } from '@runlith/held/Section';
import { ThreadCallBroke, isThreadBorderFailure, type ThreadBorderFailed } from '../ThreadBorder';

export type ThreadFlushWindowInput = {
  readonly intervalMs: number;
  readonly reportFailure: (failure: unknown) => Effect.Effect<void>;
};

export const makeThreadFlushWindow = Effect.fnUntraced(function* ({ intervalMs, reportFailure }: ThreadFlushWindowInput) {
  const scope = yield* Scope.fork(yield* Effect.scope);
  const gate = yield* Semaphore.make(1);
  const held = section<string>({
    name: 'agent-flush-window',
    owner: 'agent',
    rank: 240,
    key: (key) => key,
    threshold: Duration.seconds(10),
    ceilings: {
      hold: Duration.seconds(60),
      wait: Duration.seconds(60),
      leaves: 'the flush may have advanced; the next close must read the tail before settling',
    },
    external: 'none',
  });
  let timer: Fiber.Fiber<void> | null = null;
  let closed = false;
  let landed = false;

  const record = <A, E, R>(work: Effect.Effect<A, E, R>) => gate.withPermit(work);
  const flush = (work: Effect.Effect<void, ThreadBorderFailed>) =>
    held
      .enter('flush', work)
      .pipe(Effect.mapError((failure) => (isThreadBorderFailure(failure) ? failure : new ThreadCallBroke({ cause: failure }))));
  const serialize = (work: Effect.Effect<void, ThreadBorderFailed>) => record(flush(work));

  return {
    get stopped() {
      return closed;
    },
    record,
    flush,
    serialize,
    schedule: Effect.fnUntraced(function* (work: () => Effect.Effect<void, ThreadBorderFailed>) {
      if (closed || timer !== null) return;
      timer = yield* Effect.forkIn(
        Effect.sleep(intervalMs).pipe(
          Effect.andThen(() => {
            timer = null;
            return serialize(Effect.suspend(() => (closed ? Effect.void : work())));
          }),
          Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : reportFailure(Cause.squash(cause)))),
        ),
        scope,
      );
    }),
    close: Effect.fnUntraced(function* (work: () => Effect.Effect<void, ThreadBorderFailed>) {
      closed = true;
      const scheduled = timer;
      timer = null;
      if (scheduled !== null) yield* Fiber.interrupt(scheduled);
      yield* serialize(
        Effect.suspend(() =>
          landed
            ? Effect.void
            : work().pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    landed = true;
                  }),
                ),
              ),
        ),
      );
    }),
  };
});
