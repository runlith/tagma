import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Deferred, Effect, Fiber } from 'effect';
import { permits } from './Permits.js';

it.live('a freed permit goes to the one that waited for it, before one its holder asks for right after the release', () =>
  Effect.gen(function* () {
    const pool = permits(1);
    const order = yield* Effect.gen(function* () {
      const order: string[] = [];
      const gate = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(
        pool.within(Deferred.await(gate)).pipe(Effect.andThen(pool.within(Effect.sync(() => order.push('again'))))),
      );
      yield* Effect.yieldNow;
      const waiter = yield* Effect.forkChild(pool.within(Effect.sync(() => order.push('waiter'))));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(holder);
      yield* Fiber.join(waiter);
      return order;
    });
    expect(order).toEqual(['waiter', 'again']);
  }),
);

it.live('a waiter interrupted in the queue leaves it, and an interrupted holder gives its permit to the next', () =>
  Effect.gen(function* () {
    const pool = permits(1);
    const standing = yield* Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(pool.within(Deferred.await(gate)));
      yield* Effect.yieldNow;
      const gone = yield* Effect.forkChild(pool.within(Effect.void));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(gone);
      yield* Fiber.interrupt(holder);
      yield* pool.within(Effect.void);
      return pool.standing();
    });
    expect(standing).toEqual({ taken: 0, queued: 0 });
  }),
);
