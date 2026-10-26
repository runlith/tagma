import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { makeBackground } from './background.js';

it.effect('standing work shows its progress and pace once it outlasts a glance, and leaves when it fails', () =>
  Effect.gen(function* () {
    const background = yield* makeBackground;
    const halfway = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const running = yield* Effect.forkChild(
      background.run({ title: 'Updating thread journals', reason: 'A new form', total: 20 }, (progress) =>
        Effect.gen(function* () {
          yield* TestClock.adjust('1 second');
          expect(yield* background.standing).toEqual([]);
          for (let at = 0; at < 10; at += 1) {
            yield* TestClock.adjust('1 second');
            yield* progress.advance();
          }
          yield* progress.stage('Publishing journal indexes');
          yield* Deferred.succeed(halfway, undefined);
          yield* Deferred.await(finish);
          return yield* Effect.fail('broken');
        }),
      ),
    );
    yield* Deferred.await(halfway);
    expect(yield* background.standing).toMatchObject([
      { title: 'Updating thread journals', reason: 'Publishing journal indexes', done: 10, total: 20, remainingMs: 11_000 },
    ]);
    yield* Deferred.succeed(finish, undefined);
    expect(Exit.isFailure(yield* Fiber.await(running))).toBe(true);
    expect(yield* background.standing).toEqual([]);
  }),
);
