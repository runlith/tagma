import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { ReentrantCall } from './failures.js';
import { Origin } from './holding.js';
import { lane } from './Lane.js';

const declared = (wait = 200) =>
  lane({
    name: 'test-lane',
    owner: 'test',
    rank: 290,
    threshold: 100,
    ceilings: { step: 300, wait, leaves: 'nothing' },
    external: 'none',
  });

it.live('entries run one at a time per key, and a kept position is served before later arrivals', () =>
  Effect.gen(function* () {
    const order = yield* Effect.scoped(
      Effect.gen(function* () {
        const commits = yield* declared();
        const order: string[] = [];
        const gate = yield* Deferred.make<void>();
        const first = yield* Effect.forkChild(
          commits.enter(
            'c',
            Effect.andThen(
              Deferred.await(gate),
              Effect.sync(() => order.push('first')),
            ),
          ),
        );
        yield* Effect.yieldNow;
        const kept = commits.position();
        const later = yield* Effect.forkChild(
          commits.enter(
            'c',
            Effect.sync(() => order.push('later')),
          ),
        );
        yield* Effect.yieldNow;
        const returning = yield* Effect.forkChild(
          commits.enter(
            'c',
            Effect.sync(() => order.push('returning')),
            kept,
          ),
        );
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(later);
        yield* Fiber.join(returning);
        return order;
      }),
    );
    expect(order).toEqual(['first', 'returning', 'later']);
  }),
);

it.live('a callback whose origin is in the lane refuses at once as reentrant', () =>
  Effect.gen(function* () {
    const exit = yield* Effect.scoped(
      Effect.gen(function* () {
        const commits = yield* declared();
        return yield* Effect.exit(commits.enter('c', Effect.void).pipe(Effect.provideService(Origin, new Set(['test-lane:c']))));
      }),
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain('ReentrantCall');
  }),
);

it.live('an entry from inside a step of the same key refuses as reentrant instead of dying as a wait under hold', () =>
  Effect.gen(function* () {
    const inner = yield* Effect.scoped(
      Effect.gen(function* () {
        const commits = yield* declared();
        return yield* commits.enter('c', Effect.flip(commits.enter('c', Effect.void)));
      }),
    );
    expect(inner).toBeInstanceOf(ReentrantCall);
  }),
);

it.live('a wait past the ceiling leaves the queue, so the next entry is still served', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.scoped(
      Effect.gen(function* () {
        const commits = yield* declared(30);
        const gate = yield* Deferred.make<void>();
        const first = yield* Effect.forkChild(commits.enter('c', Deferred.await(gate)));
        yield* Effect.yieldNow;
        const stalled = yield* Effect.exit(commits.enter('c', Effect.void));
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(first);
        const after = yield* commits.enter('c', Effect.succeed('served'));
        return {
          stalled: Exit.isFailure(stalled) && JSON.stringify(stalled.cause).includes('HoldStalled'),
          after,
          standing: commits.standing(),
        };
      }),
    );
    expect(outcome).toEqual({ stalled: true, after: 'served', standing: [] });
  }),
);
