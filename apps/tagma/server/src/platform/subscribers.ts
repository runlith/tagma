import { Effect } from 'effect';

export type Subscribers<E> = {
  readonly publish: (event: E) => Effect.Effect<void>;
  readonly subscribe: (subscriber: (event: E) => Effect.Effect<void>) => () => void;
};

export const subscribersOf = <E>(failed: string, identity: (event: E) => Readonly<Record<string, unknown>>): Subscribers<E> => {
  const subscribers = new Set<(event: E) => Effect.Effect<void>>();
  return {
    publish: (event) =>
      Effect.suspend(() =>
        Effect.forEach(
          [...subscribers],
          (subscriber) =>
            Effect.catchCause(
              Effect.suspend(() => subscriber(event)),
              (cause) => Effect.logWarning(failed, { ...identity(event), cause }),
            ),
          { discard: true },
        ),
      ),
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
};
