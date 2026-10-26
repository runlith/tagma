import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { transfer } from './transfer.js';

it.effect('archive progress renews its idle allowance and a stalled transfer releases its scope', () =>
  Effect.gen(function* () {
    let held = false;
    const result = yield* Effect.gen(function* () {
      const advance = yield* Deferred.make<Effect.Effect<void>>();
      const running = yield* Effect.result(
        transfer('fixture', (progress) =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.acquireRelease(
                Effect.sync(() => {
                  held = true;
                }),
                () =>
                  Effect.sync(() => {
                    held = false;
                  }),
              );
              yield* Deferred.succeed(advance, progress);
              return yield* Effect.never;
            }),
          ),
        ),
      ).pipe(Effect.forkChild);
      const progress = yield* Deferred.await(advance);
      yield* TestClock.adjust('10 seconds');
      yield* progress;
      yield* TestClock.adjust('10 seconds');
      expect(held).toBe(true);
      yield* progress;
      yield* TestClock.adjust('15 seconds');
      expect(held).toBe(false);
      return yield* Fiber.join(running);
    });
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure._tag).toBe('GuestUnavailable');
  }),
);
