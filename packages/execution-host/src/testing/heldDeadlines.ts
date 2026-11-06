import { Clock, Deferred, Effect, Queue } from 'effect';

export type Deadlines = {
  readonly elapsePending: Effect.Effect<void>;
  readonly armedNext: Effect.Effect<Effect.Effect<void>>;
};

export const heldDeadlines = <A, E, R>(body: (deadlines: Deadlines) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Clock.clockWith((base) =>
    Effect.flatMap(Queue.unbounded<Deferred.Deferred<void>>(), (armed) => {
      const pending = new Set<Deferred.Deferred<void>>();
      const elapse = (deadline: Deferred.Deferred<void>) => Deferred.succeed(deadline, undefined);
      const clock: Clock.Clock = {
        currentTimeMillisUnsafe: () => base.currentTimeMillisUnsafe(),
        currentTimeMillis: base.currentTimeMillis,
        currentTimeNanosUnsafe: () => base.currentTimeNanosUnsafe(),
        currentTimeNanos: base.currentTimeNanos,
        monotonicTimeNanosUnsafe: () => base.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: base.monotonicTimeNanos,
        sleep: () =>
          Effect.suspend(() => {
            const deadline = Deferred.makeUnsafe<void>();
            pending.add(deadline);
            Queue.offerUnsafe(armed, deadline);
            return Deferred.await(deadline).pipe(Effect.ensuring(Effect.sync(() => pending.delete(deadline))));
          }),
      };
      const deadlines: Deadlines = {
        elapsePending: Effect.suspend(() => Effect.forEach([...pending], elapse, { discard: true })),
        armedNext: Effect.map(Queue.clear(armed), () => Effect.asVoid(Effect.flatMap(Queue.take(armed), elapse))),
      };
      return body(deadlines).pipe(Effect.provideService(Clock.Clock, clock));
    }),
  );
