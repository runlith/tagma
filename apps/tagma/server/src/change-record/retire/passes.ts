import { Cause, Effect, Exit, Semaphore } from 'effect';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { Retired, RetireFailure } from '../contract/service/retirement.js';

export const makePasses = Effect.fnUntraced(function* ({
  work,
}: {
  readonly work: (checkout: RootId) => Effect.Effect<Retired, RetireFailure>;
}) {
  const scope = yield* Effect.scope;
  const gates = new Map<RootId, Semaphore.Semaphore>();
  const requested = new Set<RootId>();
  const running = new Set<RootId>();
  const leased = new Map<RootId, number>();

  const hold = <A, E, R>(checkout: RootId, held: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    let gate = gates.get(checkout);
    if (gate === undefined) {
      gate = Semaphore.makeUnsafe(1);
      gates.set(checkout, gate);
    }
    return gate.withPermit(held);
  };

  const request = (checkout: RootId): Effect.Effect<void> =>
    Effect.uninterruptible(
      Effect.suspend(() => {
        requested.add(checkout);
        if (leased.has(checkout) || running.has(checkout)) return Effect.void;
        running.add(checkout);
        const drain = Effect.gen(function* () {
          while (requested.has(checkout) && !leased.has(checkout)) {
            const exit = yield* Effect.exit(
              hold(
                checkout,
                Effect.suspend(() => {
                  if (leased.has(checkout) || !requested.delete(checkout)) return Effect.void;
                  return work(checkout);
                }),
              ),
            );
            if (Exit.isFailure(exit)) {
              if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause);
              yield* Effect.logWarning('the retirement pass stopped; the next request takes it up', {
                checkout,
                reason: Cause.pretty(exit.cause),
              });
            }
          }
        }).pipe(
          Effect.onExit((exit) =>
            Effect.suspend(() => {
              running.delete(checkout);
              if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return Effect.void;
              return requested.has(checkout) && !leased.has(checkout) ? request(checkout) : Effect.void;
            }),
          ),
        );
        return Effect.asVoid(Effect.forkIn(drain, scope));
      }),
    );

  return {
    hold,
    request,
    pass: (checkout: RootId): Effect.Effect<Retired, RetireFailure> =>
      hold(
        checkout,
        Effect.suspend(() => {
          requested.delete(checkout);
          return work(checkout);
        }),
      ),
    lease: <A, E, R>(checkout: RootId, held: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        Effect.sync(() => leased.set(checkout, (leased.get(checkout) ?? 0) + 1)),
        () => Effect.andThen(hold(checkout, Effect.void), held),
        () =>
          Effect.suspend(() => {
            const left = (leased.get(checkout) ?? 1) - 1;
            if (left > 0) {
              leased.set(checkout, left);
              return Effect.void;
            }
            leased.delete(checkout);
            return requested.has(checkout) ? request(checkout) : Effect.void;
          }),
      ),
  };
});
