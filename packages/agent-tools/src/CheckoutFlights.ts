import { Deferred, Effect, Exit, type Fiber } from 'effect';
import type { ChangeSource } from './changeSource';
import { CheckoutFrontier, type Reading } from './checkoutState';

type Stage = {
  readonly reading: Deferred.Deferred<Reading>;
  readonly measure: Effect.Effect<Reading>;
  waiters: number;
  fiber: Fiber.Fiber<Reading> | null;
};

type Flight = { running: Stage; queued: Stage | null };
type Namespace = {
  readonly flights: Map<string, Flight>;
  readonly frontiers: Map<string, CheckoutFrontier>;
};

const KEPT_CHECKOUTS = 32;

export class CheckoutFlights {
  private readonly namespaces = new WeakMap<object, Namespace>();

  constructor(readonly source: ChangeSource | null = null) {}

  readonly join = (
    namespace: object,
    checkout: string,
    measure: (frontier: CheckoutFrontier) => Effect.Effect<Reading>,
  ): Effect.Effect<Reading> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        const state: Namespace = this.namespaces.get(namespace) ?? { flights: new Map(), frontiers: new Map() };
        this.namespaces.set(namespace, state);
        const flight = state.flights.get(checkout);
        const read = Effect.suspend(() => {
          const frontier = state.frontiers.get(checkout) ?? new CheckoutFrontier();
          state.frontiers.delete(checkout);
          state.frontiers.set(checkout, frontier);
          if (state.frontiers.size > KEPT_CHECKOUTS) state.frontiers.delete(state.frontiers.keys().next().value as string);
          return measure(frontier).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (Exit.isFailure(exit) || 'unreadable' in exit.value) frontier.lost();
              }),
            ),
          );
        });
        const stage = flight === undefined ? staged(read) : (flight.queued ??= staged(read));
        stage.waiters += 1;
        const started = flight === undefined ? this.fly(state, checkout, this.reserve(state, checkout, stage)) : Effect.void;
        return started.pipe(
          Effect.andThen(restore(Deferred.await(stage.reading))),
          Effect.onInterrupt(() => Effect.sync(() => this.leave(state, checkout, stage))),
        );
      }),
    );

  private readonly reserve = (state: Namespace, checkout: string, running: Stage): Flight => {
    const flight: Flight = { running, queued: null };
    state.flights.set(checkout, flight);
    return flight;
  };

  private readonly fly = (state: Namespace, checkout: string, flight: Flight): Effect.Effect<void> => {
    const stage = flight.running;
    return Effect.forkDetach(
      stage.measure.pipe(
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            Deferred.doneUnsafe(stage.reading, exit);
            const next = flight.queued;
            if (next === null) {
              state.flights.delete(checkout);
              return Effect.void;
            }
            return this.fly(state, checkout, this.reserve(state, checkout, next));
          }),
        ),
      ),
    ).pipe(
      Effect.map((fiber) => {
        stage.fiber = fiber;
        if (stage.waiters === 0) fiber.interruptUnsafe();
      }),
    );
  };

  private readonly leave = (state: Namespace, checkout: string, stage: Stage): void => {
    stage.waiters -= 1;
    if (stage.waiters > 0) return;
    const flight = state.flights.get(checkout);
    if (flight?.queued === stage) flight.queued = null;
    else if (flight?.running === stage) stage.fiber?.interruptUnsafe();
  };
}

const staged = (measure: Effect.Effect<Reading>): Stage => ({
  reading: Deferred.makeUnsafe<Reading>(),
  measure,
  waiters: 0,
  fiber: null,
});
