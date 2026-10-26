import { Effect, Queue, Stream } from 'effect';

export type FeedBytes<A> = { readonly limit: number; readonly weigh: (event: A) => number };

type Held<A> = { readonly event: A; readonly weight: number } | null;

export function snapshotFeed<A, B, E, R>(
  subscribe: (listener: (event: A) => void) => () => void,
  snapshot: (first: boolean) => Effect.Effect<{ readonly value: B; readonly covered: (event: A) => boolean }, E, R>,
  project: (event: A) => Effect.Effect<B, E, R>,
  capacity: number,
  bytes?: FeedBytes<A>,
): Stream.Stream<B, E, R> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const events = yield* Queue.make<Held<A>>({ capacity, strategy: 'dropping' });
      let overflow = false;
      let first = true;
      let held = 0;
      let covered: (event: A) => boolean = () => false;
      const overflowed = () => {
        overflow = true;
        Queue.offerUnsafe(events, null);
      };
      const detach = subscribe((event) => {
        if (overflow) return;
        const weight = bytes?.weigh(event) ?? 0;
        if (bytes !== undefined && held + weight > bytes.limit) return overflowed();
        if (!Queue.offerUnsafe(events, { event, weight })) return overflowed();
        held += weight;
      });
      yield* Effect.addFinalizer(() => Effect.sync(detach));
      const pull = Effect.gen(function* () {
        for (;;) {
          if (first || overflow) {
            yield* Queue.clear(events);
            held = 0;
            overflow = false;
            const next = yield* snapshot(first);
            first = false;
            covered = next.covered;
            return [next.value] as const;
          }
          const taken = yield* Queue.take(events);
          if (taken === null) continue;
          held -= taken.weight;
          if (overflow || covered(taken.event)) continue;
          return [yield* project(taken.event)] as const;
        }
      });
      return Stream.fromPull(Effect.succeed(pull));
    }),
  );
}
