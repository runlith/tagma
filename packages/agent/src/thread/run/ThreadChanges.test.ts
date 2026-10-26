import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { ThreadChanges, threadChangesLayer } from './ThreadChanges';
const timesOut = Effect.fnUntraced(function* (work: Effect.Effect<unknown>) {
  const fiber = yield* work.pipe(Effect.timeoutOption(1), Effect.forkScoped);
  yield* TestClock.adjust(1);
  return Option.isNone(yield* Fiber.join(fiber));
});
layer(threadChangesLayer)('ThreadChanges registrations', (it) => {
  it.effect(
    'a publication between registration and awaiting remains observable',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* changes.watch(['recipient', 'target']);
      yield* changes.publish('target');
      expect(yield* timesOut(changed)).toBe(false);
    }),
  );
  it.effect(
    'a different thread cannot release the registration',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* changes.watch(['target']);
      yield* changes.publish('unrelated');
      expect(yield* timesOut(changed)).toBe(true);
    }),
  );
  it.effect(
    'normal scope completion releases an unconsumed registration',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* Effect.scoped(changes.watch(['target']));
      yield* changes.publish('target');
      expect(yield* timesOut(changed)).toBe(true);
    }),
  );
  it.effect(
    'interruption releases its registration without removing a sibling watch',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const exposed = yield* Deferred.make<Effect.Effect<readonly string[]>>();
      const child = yield* Effect.scoped(
        Effect.gen(function* () {
          const changed = yield* changes.watch(['target']);
          yield* Deferred.succeed(exposed, changed);
          yield* Effect.never;
        }),
      ).pipe(Effect.forkScoped);
      const cancelled = yield* Deferred.await(exposed);
      const standing = yield* changes.watch(['target']);
      yield* Fiber.interrupt(child);
      yield* changes.publish('target');
      expect(yield* timesOut(cancelled)).toBe(true);
      expect(yield* timesOut(standing)).toBe(false);
    }),
  );
});
