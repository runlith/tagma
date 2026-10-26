import { Deferred, Effect, Fiber, Queue, type Scope } from 'effect';
import type { Worker } from 'effect/workers/Worker';
import type { WorkerError } from 'effect/workers/WorkerError';

export const prepareWorker = Effect.fn('Worker.prepare')(function* <O, I>(
  worker: Worker<O, I>,
): Effect.fn.Return<Worker<O, I>, WorkerError, Scope.Scope> {
  const ready = yield* Deferred.make<void>();
  const answers = yield* Queue.unbounded<O>();
  const running = yield* Effect.forkScoped(
    worker.run((answer) => Queue.offer(answers, answer), { onSpawn: Effect.asVoid(Deferred.succeed(ready, undefined)) }),
  );
  yield* Effect.raceFirst(Deferred.await(ready), Fiber.join(running));
  let taken = false;
  const prepared: Worker<O, I> = {
    send: worker.send,
    run: (handler, options) =>
      Effect.suspend(() => {
        if (taken) return worker.run(handler, options);
        taken = true;
        return Effect.andThen(options?.onSpawn ?? Effect.void, Effect.forever(Effect.flatMap(Queue.take(answers), handler))).pipe(
          Effect.raceFirst(Fiber.join(running)),
          Effect.ensuring(Fiber.interrupt(running)),
        );
      }),
  };
  return prepared;
});
