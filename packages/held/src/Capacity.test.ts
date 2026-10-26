import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { capacity, type Phase } from './Capacity.js';
import { CapacityBusy, WaitUnderHold } from './failures.js';
import { declare } from './Held.js';
import { StallRecords } from './holding.js';

const quiet = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.exit(Effect.scoped(effect).pipe(Effect.provideService(StallRecords, () => Effect.void)));
const failure = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined);

const heavy = (klass: Phase['class'], name: string = klass): Phase => ({ name, class: klass, needs: [{ pool: 'heavy', units: 1 }] });
const ledger = () => capacity([{ name: 'heavy', units: 3, limits: { call: 2, background: 1 } }], { admission: 1000, queued: 1000 });

it.live('calls leave the recovery reserve free, and background stays within its own share', () =>
  Effect.gen(function* () {
    const slots = ledger();
    const exit = yield* quiet(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const held = (phase: Phase) => Effect.forkChild(slots.ticket(phase, Deferred.await(gate)));
        yield* held(heavy('background'));
        const second = yield* held(heavy('background', 'second'));
        yield* held(heavy('call'));
        yield* held(heavy('recovery'));
        yield* Effect.yieldNow;
        const standing = slots.standing()[0];
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(second);
        return standing;
      }),
    );
    expect(exit).toEqual(Exit.succeed({ pool: 'heavy', units: 3, taken: { call: 1, recovery: 1, background: 1 }, queued: 1 }));
    expect(slots.standing()[0]?.taken).toEqual({ call: 0, recovery: 0, background: 0 });
  }),
);

it.live('a freed unit goes to a waiting call before a background that queued earlier', () =>
  Effect.gen(function* () {
    const slots = capacity([{ name: 'heavy', units: 2, limits: { call: 2, background: 1 } }], { admission: 1000, queued: 1000 });
    const exit = yield* quiet(
      Effect.gen(function* () {
        const held = yield* Deferred.make<void>();
        const freed = yield* Deferred.make<void>();
        yield* Effect.forkChild(slots.ticket(heavy('call'), Deferred.await(held)));
        yield* Effect.forkChild(slots.ticket(heavy('background'), Deferred.await(freed)));
        yield* Effect.yieldNow;
        yield* Effect.forkChild(slots.ticket(heavy('background', 'late'), Deferred.await(held)));
        yield* Effect.yieldNow;
        yield* Effect.forkChild(slots.ticket(heavy('call', 'later'), Deferred.await(held)));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(freed, undefined);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        const standing = slots.standing()[0];
        yield* Deferred.succeed(held, undefined);
        return standing;
      }),
    );
    expect(exit).toEqual(Exit.succeed({ pool: 'heavy', units: 2, taken: { call: 2, recovery: 0, background: 0 }, queued: 1 }));
  }),
);

it.live('a request on a free pool is admitted while a request of its class waits on another pool', () =>
  Effect.gen(function* () {
    const slots = capacity(
      [
        { name: 'heavy', units: 1, limits: { call: 1, background: 1 } },
        { name: 'reads', units: 1, limits: { call: 1, background: 1 } },
      ],
      { admission: 1000, queued: 1000 },
    );
    const exit = yield* quiet(
      Effect.gen(function* () {
        const held = yield* Deferred.make<void>();
        yield* Effect.forkChild(slots.ticket(heavy('call'), Deferred.await(held)));
        yield* Effect.forkChild(slots.ticket(heavy('call', 'waiting'), Effect.void));
        yield* Effect.yieldNow;
        const read = yield* slots.ticket({ name: 'read', class: 'call', needs: [{ pool: 'reads', units: 1 }] }, Effect.succeed('read'));
        yield* Deferred.succeed(held, undefined);
        return read;
      }),
    );
    expect(exit).toEqual(Exit.succeed('read'));
  }),
);

it.live('a ticket is released on interruption, and the next waiter is served', () =>
  Effect.gen(function* () {
    const slots = capacity([{ name: 'heavy', units: 1, limits: { call: 1, background: 1 } }], { admission: 1000, queued: 1000 });
    const exit = yield* quiet(
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(slots.ticket(heavy('call'), Effect.never));
        yield* Effect.yieldNow;
        const second = yield* Effect.forkChild(slots.ticket(heavy('call', 'next'), Effect.succeed('served')));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(first);
        return yield* Fiber.join(second);
      }),
    );
    expect(exit).toEqual(Exit.succeed('served'));
  }),
);

it.live('an admission whose expected wait passes the ceiling refuses busy before it queues', () =>
  Effect.gen(function* () {
    const slots = capacity([{ name: 'heavy', units: 1, limits: { call: 1, background: 1 } }], { admission: 5, queued: 1000 });
    const exit = yield* quiet(
      Effect.gen(function* () {
        yield* slots.ticket(heavy('call'), Effect.sleep(20));
        const holder = yield* Effect.forkChild(slots.ticket(heavy('call'), Effect.never));
        yield* Effect.yieldNow;
        const refused = yield* Effect.exit(slots.ticket(heavy('call', 'late'), Effect.void));
        yield* Fiber.interrupt(holder);
        return refused;
      }),
    );
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
    expect(failure(exit.value)).toBeInstanceOf(CapacityBusy);
  }),
);

it.live('a nonwaiting lease grants available capacity and returns it once', () =>
  Effect.gen(function* () {
    const slots = capacity([{ name: 'watch', units: 1, limits: { call: 1, background: 1 } }], { admission: 1000, queued: 1000 });
    const phase: Phase = { name: 'watch', class: 'call', needs: [{ pool: 'watch', units: 1 }] };
    const first = yield* slots.tryLease(phase);
    expect(typeof first).toBe('function');
    expect(yield* slots.tryLease(phase)).toBeNull();
    first?.();
    first?.();
    expect(slots.standing()[0]?.taken.call).toBe(0);
    const next = yield* slots.tryLease(phase);
    expect(typeof next).toBe('function');
    next?.();
  }),
);

it.effect('nonwaiting leases teach admission the same runtime-clock holding time as tickets', () =>
  Effect.gen(function* () {
    const slots = capacity([{ name: 'heavy', units: 1, limits: { call: 1, background: 1 } }], { admission: 5, queued: 1000 });
    const release = yield* slots.tryLease(heavy('call'));
    if (release === null) return yield* Effect.die('the empty pool refused its first lease');
    yield* TestClock.adjust(20);
    release();
    const holding = yield* slots.tryLease(heavy('call'));
    if (holding === null) return yield* Effect.die('the released pool refused its next lease');
    yield* Effect.addFinalizer(() => Effect.sync(holding));
    const refused = yield* Effect.flip(slots.ticket(heavy('call', 'next'), Effect.void));
    expect(refused).toMatchObject({ _tag: 'CapacityBusy', expectedMs: 20 });
  }),
);

it.live('a ticket is taken before any hold of its phase', () =>
  Effect.gen(function* () {
    const tree = declare<string>({
      name: 'tree',
      owner: 'test',
      rank: 420,
      key: (key) => key,
      concurrency: 1,
      threshold: 100,
      ceilings: { hold: 200, wait: 200, leaves: 'nothing' },
      external: 'none',
    });
    const exit = yield* quiet(tree.hold('a', ledger().ticket(heavy('call'), Effect.void)));
    expect(failure(exit)).toBeInstanceOf(WaitUnderHold);
  }),
);
