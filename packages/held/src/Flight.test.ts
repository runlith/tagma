import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Cause, Deferred, Effect, Exit, Fiber, type Scope } from 'effect';
import { HoldStalled, ReentrantCall, WaitUnderHold } from './failures.js';
import { flight } from './Flight.js';
import { declare } from './Held.js';
import { Origin, StallRecords } from './holding.js';

const quiet = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.exit(Effect.scoped(effect).pipe(Effect.provideService(StallRecords, () => Effect.void)));

const failure = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined);

const repair = { name: 'repair', owner: 'test', key: (key: string) => key, ceiling: 50 };

it.live('callers of one key join the flight in progress and receive its one result', () =>
  Effect.gen(function* () {
    let runs = 0;
    const exit = yield* quiet(
      Effect.gen(function* () {
        const repairs = yield* flight<string, number, never>(repair);
        const release = yield* Deferred.make<void>();
        const work = Effect.andThen(
          Deferred.await(release),
          Effect.sync(() => ++runs),
        );
        const first = yield* Effect.forkChild(repairs.join('tree', work));
        const second = yield* Effect.forkChild(repairs.join('tree', work));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      }),
    );
    expect(exit).toEqual(Exit.succeed([1, 1]));
    expect(runs).toBe(1);
  }),
);

it.live('a joiner past the ceiling answers outcome none while the flight goes on', () =>
  Effect.gen(function* () {
    const exit = yield* quiet(
      Effect.gen(function* () {
        const repairs = yield* flight<string, string, never>(repair);
        const release = yield* Deferred.make<void>();
        const waited = yield* Effect.exit(repairs.join('tree', Effect.as(Deferred.await(release), 'done')));
        const standing = repairs.standing();
        yield* Deferred.succeed(release, undefined);
        return { waited, standing };
      }),
    );
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
    expect(failure(exit.value.waited)).toBeInstanceOf(HoldStalled);
    expect(exit.value.standing).toEqual(['tree']);
  }),
);

it.live('joining under a hold is a defect, and a callback into the flight its origin is in is refused as reentrant', () =>
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
    const underHold = yield* quiet(
      Effect.flatMap(flight<string, void, never>(repair), (repairs) => tree.hold('a', repairs.join('tree', Effect.void))),
    );
    expect(failure(underHold)).toBeInstanceOf(WaitUnderHold);
    const callback = yield* quiet(
      Effect.flatMap(flight<string, void, never>(repair), (repairs) =>
        repairs.join('tree', Effect.void).pipe(Effect.provideService(Origin, new Set(['repair:tree']))),
      ),
    );
    expect(failure(callback)).toBeInstanceOf(ReentrantCall);
  }),
);
