import { Context, Effect, Fiber, Queue, Stream } from 'effect';
import { CurrentCost, producerCost, type CostCause } from '@runlith/performance/CostLedger';

export type FeedBytes<A> = { readonly limit: number; readonly weigh: (event: A) => number };

type Held<A> = { readonly event: A; readonly weight: number; readonly cause: CostCause | null } | null;

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
      let overflowCause: CostCause | null = null;
      let first = true;
      let held = 0;
      let covered: (event: A) => boolean = () => false;
      const overflowed = () => {
        const context = Fiber.getCurrent()?.context;
        overflowCause = context === undefined ? null : Context.get(context, CurrentCost);
        overflow = true;
        Queue.offerUnsafe(events, null);
      };
      const detach = subscribe((event) => {
        if (overflow) return;
        const weight = bytes?.weigh(event) ?? 0;
        if (bytes !== undefined && held + weight > bytes.limit) return overflowed();
        const context = Fiber.getCurrent()?.context;
        const cause = context === undefined ? null : Context.get(context, CurrentCost);
        if (!Queue.offerUnsafe(events, { event, weight, cause })) return overflowed();
        held += weight;
      });
      yield* Effect.addFinalizer(() => Effect.sync(detach));
      const pull = Effect.gen(function* () {
        for (;;) {
          if (first || overflow) {
            yield* Queue.clear(events);
            held = 0;
            overflow = false;
            const refreshing = producerCost('ThreadFeeds.snapshot', snapshot(first));
            const next = yield* first ? refreshing : Effect.provideService(refreshing, CurrentCost, overflowCause);
            overflowCause = null;
            first = false;
            covered = next.covered;
            return [next.value] as const;
          }
          const taken = yield* Queue.take(events);
          if (taken === null) continue;
          held -= taken.weight;
          if (overflow || covered(taken.event)) continue;
          return [
            yield* Effect.provideService(producerCost('ThreadFeeds.project', project(taken.event)), CurrentCost, taken.cause),
          ] as const;
        }
      });
      return Stream.fromPull(Effect.succeed(pull));
    }),
  );
}
