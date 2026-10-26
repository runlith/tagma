import { Context, Deferred, Effect, Layer, type Scope } from 'effect';

export class ThreadChanges extends Context.Service<
  ThreadChanges,
  {
    watch(threadIds: readonly string[]): Effect.Effect<Effect.Effect<readonly string[]>, never, Scope.Scope>;
    publish(threadId: string): Effect.Effect<void>;
  }
>()('@runlith/agent/ThreadChanges') {}

type Subscription = { readonly moved: Set<string>; wake: Deferred.Deferred<void> | null };

export const threadChangesLayer = Layer.sync(ThreadChanges, () => {
  const subscribed = new Map<string, Set<Subscription>>();

  const drain = Effect.fnUntraced(function* (subscription: Subscription): Effect.fn.Return<readonly string[]> {
    const wake = yield* Deferred.make<void>();
    if (subscription.moved.size === 0) {
      subscription.wake = wake;
      yield* Deferred.await(wake);
    }
    const moved = [...subscription.moved];
    subscription.moved.clear();
    return moved;
  });

  return ThreadChanges.of({
    watch: (threadIds) =>
      Effect.map(
        Effect.acquireRelease(
          Effect.sync(() => {
            const subscription: Subscription = { moved: new Set(), wake: null };
            for (const id of new Set(threadIds)) {
              const standing = subscribed.get(id);
              if (standing) standing.add(subscription);
              else subscribed.set(id, new Set([subscription]));
            }
            return subscription;
          }),
          (subscription) =>
            Effect.sync(() => {
              for (const id of new Set(threadIds)) {
                const standing = subscribed.get(id);
                standing?.delete(subscription);
                if (standing?.size === 0) subscribed.delete(id);
              }
            }),
        ),
        drain,
      ),
    publish: (threadId) =>
      Effect.suspend(() =>
        Effect.forEach(
          [...(subscribed.get(threadId) ?? [])],
          (subscription) => {
            subscription.moved.add(threadId);
            const wake = subscription.wake;
            subscription.wake = null;
            return wake === null ? Effect.void : Deferred.succeed(wake, undefined);
          },
          { discard: true },
        ),
      ),
  });
});
