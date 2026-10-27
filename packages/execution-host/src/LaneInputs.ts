import { Deferred, Effect, Exit, type Scope } from 'effect';
import type { BindingId } from '@runlith/executions/protocol/custody';
import type { LaneInput } from '@runlith/executions/protocol/lane';

export type LaneWatch = { readonly next: Effect.Effect<LaneInput> };

export type LaneInputs = {
  readonly track: (binding: BindingId) => Effect.Effect<void>;
  readonly forget: (binding: BindingId) => Effect.Effect<void>;
  readonly publish: (input: LaneInput) => Effect.Effect<void>;
  readonly watch: Effect.Effect<LaneWatch, never, Scope.Scope>;
};

type Watcher = { readonly latest: Map<BindingId, LaneInput>; wake: Deferred.Deferred<void> | undefined };

export const makeLaneInputs = (): LaneInputs => {
  const watchers = new Set<Watcher>();
  const tracked = new Set<BindingId>();

  const nextOf = (watcher: Watcher): Effect.Effect<LaneInput> =>
    Effect.suspend(() => {
      for (const [binding, input] of watcher.latest) {
        watcher.latest.delete(binding);
        return Effect.succeed(input);
      }
      watcher.wake ??= Deferred.makeUnsafe<void>();
      return Effect.andThen(Deferred.await(watcher.wake), nextOf(watcher));
    });

  return {
    track: (binding) => Effect.sync(() => void tracked.add(binding)),
    forget: (binding) =>
      Effect.sync(() => {
        tracked.delete(binding);
        for (const watcher of watchers) watcher.latest.delete(binding);
      }),
    publish: (input) =>
      Effect.sync(() => {
        if (!tracked.has(input.binding)) return;
        for (const watcher of watchers) {
          watcher.latest.delete(input.binding);
          watcher.latest.set(input.binding, input);
          const wake = watcher.wake;
          watcher.wake = undefined;
          if (wake !== undefined) Deferred.doneUnsafe(wake, Exit.void);
        }
      }),
    watch: Effect.map(
      Effect.acquireRelease(
        Effect.sync(() => {
          const watcher: Watcher = { latest: new Map(), wake: undefined };
          watchers.add(watcher);
          return watcher;
        }),
        (watcher) => Effect.sync(() => watchers.delete(watcher)),
      ),
      (watcher) => ({ next: nextOf(watcher) }),
    ),
  };
};
