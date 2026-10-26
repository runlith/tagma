import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { Turns } from './turns.js';

const holding = (turns: Turns, gate: Deferred.Deferred<void>, want: Parameters<Turns['within']>[0] = {}) =>
  turns.within(want, (seat) => Deferred.await(gate).pipe(Effect.as(seat)));

it.effect('a freed seat goes to the ask that waited for it, before one its holder makes right after the release', () =>
  Effect.gen(function* () {
    const order: string[] = [];
    const turns = new Turns(1);
    const gate = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(
      holding(turns, gate).pipe(Effect.andThen(turns.within({}, () => Effect.sync(() => order.push('again'))))),
    );
    yield* Effect.yieldNow;
    const waiter = yield* Effect.forkChild(turns.within({}, () => Effect.sync(() => order.push('waiter'))));
    yield* Effect.yieldNow;
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(waiter);
    expect(order).toEqual(['waiter', 'again']);
  }),
);

it.effect('an ask any seat can take is seated on a free one at once, even when it prefers the busy one', () =>
  Effect.gen(function* () {
    const turns = new Turns(2);
    const gate = yield* Deferred.make<void>();
    const busy = yield* Effect.forkChild(holding(turns, gate, { seat: 0 }));
    yield* Effect.yieldNow;
    const taken = yield* turns.within({ prefer: 0 }, (at) => Effect.succeed(at));
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(busy);
    expect(taken).toBe(1);
  }),
);

it.effect('an ask pinned to a busy seat waits for it while another seat stands free', () =>
  Effect.gen(function* () {
    const turns = new Turns(2);
    const gate = yield* Deferred.make<void>();
    const busy = yield* Effect.forkChild(holding(turns, gate, { seat: 0 }));
    yield* Effect.yieldNow;
    const pinned = yield* Effect.forkChild(turns.within({ seat: 0 }, (at) => Effect.succeed(at)));
    yield* Effect.yieldNow;
    const waited = pinned.pollUnsafe() === undefined;
    yield* Deferred.succeed(gate, undefined);
    expect({ held: yield* Fiber.join(busy), pinned: yield* Fiber.join(pinned), waited }).toEqual({ held: 0, pinned: 0, waited: true });
  }),
);

it('a sliced job keeps its worker wanted between requests until it releases its hold', () => {
  const turns = new Turns(1);
  const release = turns.hold(0);
  expect(turns.wanted(0)).toBe(true);
  release();
  expect(turns.wanted(0)).toBe(false);
});

it.effect('an ask interrupted while it waits leaves the queue, and an interrupted holder frees its seat', () =>
  Effect.gen(function* () {
    const turns = new Turns(1);
    const gate = yield* Deferred.make<void>();
    const holder = yield* Effect.forkChild(holding(turns, gate));
    yield* Effect.yieldNow;
    const gone = yield* Effect.forkChild(turns.within({}, (at) => Effect.succeed(at)));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(gone);
    yield* Fiber.interrupt(holder);
    expect(yield* turns.within({}, (at) => Effect.succeed(at))).toBe(0);
  }),
);
