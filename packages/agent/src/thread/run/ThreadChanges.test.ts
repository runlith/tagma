import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { ThreadChanges, threadChangesLayer } from './ThreadChanges';
const pending = Effect.fnUntraced(function* (work: Effect.Effect<unknown>) {
  const fiber = yield* Effect.forkScoped(work, { startImmediately: true });
  yield* Fiber.interrupt(fiber);
  return Exit.hasInterrupts(yield* Fiber.await(fiber));
});
layer(threadChangesLayer)('ThreadChanges registrations', (it) => {
  it.effect(
    'a publication between registration and awaiting remains observable',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* changes.watch(['recipient', 'target']);
      yield* changes.publish('target');
      expect(yield* changed).toEqual(['target']);
    }),
  );
  it.effect(
    'a different thread cannot release the registration',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* changes.watch(['target']);
      yield* changes.publish('unrelated');
      expect(yield* pending(changed)).toBe(true);
    }),
  );
  it.effect(
    'normal scope completion releases an unconsumed registration',
    Effect.fnUntraced(function* () {
      const changes = yield* ThreadChanges;
      const changed = yield* Effect.scoped(changes.watch(['target']));
      yield* changes.publish('target');
      expect(yield* pending(changed)).toBe(true);
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
      expect(yield* pending(cancelled)).toBe(true);
      expect(yield* standing).toEqual(['target']);
    }),
  );
});
