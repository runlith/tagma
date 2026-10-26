import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { ReaderLanes } from './ReaderLanes.js';

const heldUntil = (lanes: ReaderLanes, kind: 'point' | 'bulk', ready: Deferred.Deferred<number>, done: Deferred.Deferred<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const borrowed = yield* lanes.take(kind);
      yield* Deferred.succeed(ready, borrowed.lane);
      yield* Deferred.await(done);
      return borrowed.lane;
    }),
  );

it.effect('bulk reads across stores leave a lane for a point read and wait until bulk capacity frees', () =>
  Effect.gen(function* () {
    const lanes = new ReaderLanes(2);
    const ready = yield* Deferred.make<number>();
    const done = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(heldUntil(lanes, 'bulk', ready, done));
    const bulkLane = yield* Deferred.await(ready);
    let bulkAnswered = false;
    const second = yield* Effect.forkChild(
      Effect.scoped(
        Effect.map(lanes.take('bulk'), (lane) => {
          bulkAnswered = true;
          return lane.lane;
        }),
      ),
    );
    yield* Effect.yieldNow;
    const point = yield* Effect.scoped(Effect.map(lanes.take('point'), (lane) => lane.lane));
    expect(point).not.toBe(bulkLane);
    expect(bulkAnswered).toBe(false);
    yield* Deferred.succeed(done, undefined);
    yield* Fiber.join(first);
    expect(yield* Fiber.join(second)).toBe(bulkLane);
  }),
);

it.effect('cancelled and explicitly released leases do not strand or multiply reader capacity', () =>
  Effect.gen(function* () {
    const lanes = new ReaderLanes(1);
    const ready = yield* Deferred.make<number>();
    const done = yield* Deferred.make<void>();
    const holder = yield* Effect.forkChild(heldUntil(lanes, 'point', ready, done));
    const held = yield* Deferred.await(ready);
    const cancelled = yield* Effect.forkChild(Effect.scoped(lanes.take('point')));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(cancelled);
    yield* Deferred.succeed(done, undefined);
    yield* Fiber.join(holder);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const first = yield* lanes.take('point');
        expect(first.lane).toBe(held);
        first.release();
        const next = yield* lanes.take('point');
        expect(next.lane).toBe(held);
      }),
    );
    const final = yield* Effect.scoped(lanes.take('point'));
    expect(final.lane).toBe(held);
  }),
);
