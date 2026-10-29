import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunWorker from '@effect/platform-bun/BunWorker';
import { Deferred, Effect, Fiber, FileSystem } from 'effect';
import { TestClock } from 'effect/testing';
import { WorkerPlatform } from 'effect/workers/Worker';

it.effect('closing an unready worker releases its runner without spending the shutdown grace period', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const entry = yield* files.makeTempFileScoped({ prefix: 'unready-worker-', suffix: '.ts' });
    yield* files.writeFileString(entry, 'self.addEventListener("message", () => {});\n');
    const spawned = yield* Deferred.make<void>();
    const closed = yield* Deferred.make<void>();
    yield* Effect.gen(function* () {
      const worker = yield* (yield* WorkerPlatform).spawn(0);
      const runner = yield* Effect.forkScoped(worker.run(() => Effect.void));
      yield* Deferred.await(spawned);
      yield* TestClock.adjust(0);
      const closing = yield* Effect.forkScoped(Fiber.interrupt(runner).pipe(Effect.andThen(Deferred.succeed(closed, undefined))));
      yield* TestClock.adjust(0);
      const immediate = yield* Deferred.isDone(closed);
      yield* TestClock.adjust('5 seconds');
      yield* Fiber.join(closing);
      expect(immediate).toBe(true);
    }).pipe(
      Effect.provide(
        BunWorker.layer(() => {
          const worker = new Worker(entry, { type: 'module' });
          Deferred.doneUnsafe(spawned, Effect.void);
          return worker;
        }),
      ),
    );
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
