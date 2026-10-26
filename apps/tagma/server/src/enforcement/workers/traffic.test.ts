import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { makeTraffic } from './traffic.js';

it.effect('background work waits for foreground work admitted on any lane, between its requests', () =>
  Effect.gen(function* () {
    const traffic = makeTraffic();
    const order: string[] = [];
    const gate = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(traffic.run(Deferred.await(gate)));
    yield* Effect.yieldNow;
    const background = yield* Effect.forkChild(traffic.idle(Effect.sync(() => order.push('background'))));
    yield* Effect.yieldNow;
    yield* traffic.run(Effect.sync(() => order.push('foreground')));
    expect(order).toEqual(['foreground']);
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(background);
    expect(order).toEqual(['foreground', 'background']);
  }),
);

it.effect('interruption removes a waiting background request and releases foreground admission', () =>
  Effect.gen(function* () {
    const traffic = makeTraffic();
    const order: string[] = [];
    const foreground = yield* Effect.forkChild(traffic.run(Effect.never));
    yield* Effect.yieldNow;
    const gone = yield* Effect.forkChild(traffic.idle(Effect.sync(() => order.push('interrupted'))));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(gone);
    yield* Fiber.interrupt(foreground);
    yield* traffic.idle(Effect.sync(() => order.push('measured')));
    expect(order).toEqual(['measured']);
  }),
);
