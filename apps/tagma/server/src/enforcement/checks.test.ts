import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { triggerIndex } from './judging/ruleChecks.js';

const PROJECT = 7;

it.effect('a trigger read that began before an enforcement write never stands after it', () =>
  Effect.gen(function* () {
    let reads = 0;
    const gate = yield* Deferred.make<void>();
    const triggers = triggerIndex(() =>
      Effect.suspend(() => {
        reads += 1;
        return reads === 1
          ? Effect.andThen(Deferred.await(gate), Effect.fail({ message: 'slow first read' }))
          : Effect.fail({ message: 'no graph in a unit test' });
      }),
    );
    const slow = yield* Effect.forkChild(triggers.wanted(PROJECT, 'submit_work', 'before'));
    yield* Effect.yieldNow;
    triggers.forget(PROJECT);
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(slow);
    yield* triggers.wanted(PROJECT, 'submit_work', 'before');
    expect(reads).toBe(2);
  }),
);

it.effect('concurrent trigger misses share one project reading', () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const entered = yield* Deferred.make<void>();
    let reads = 0;
    const triggers = triggerIndex(() =>
      Effect.suspend(() => {
        reads += 1;
        return Effect.andThen(
          Deferred.succeed(entered, undefined),
          Effect.andThen(Deferred.await(gate), Effect.fail({ message: 'graph unreadable' })),
        );
      }),
    );
    const first = yield* Effect.forkChild(triggers.wanted(PROJECT, 'submit_work', 'before'));
    const second = yield* Effect.forkChild(triggers.wanted(PROJECT, 'read_block', 'after'));
    yield* Deferred.await(entered);
    expect(reads).toBe(1);
    yield* Deferred.succeed(gate, undefined);
    expect(yield* Fiber.join(first)).toBe(false);
    expect(yield* Fiber.join(second)).toBe(false);
    expect(reads).toBe(1);
  }),
);
