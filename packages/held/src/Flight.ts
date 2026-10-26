import { Clock, Deferred, Duration, Effect, Option, type Scope } from 'effect';
import { HoldStalled, ReentrantCall, ResourceInvalid, WaitUnderHold } from './failures.js';
import { CEILING_CAP } from './Held.js';
import { Holding, liveHolds, liveTickets, Origin, stall } from './holding.js';

export type FlightDeclaration<K> = {
  readonly name: string;
  readonly owner: string;
  readonly key: (key: K) => string;
  readonly ceiling: Duration.Input;
};

export type Flight<K, A, E> = {
  readonly declaration: FlightDeclaration<K>;
  join(key: K, work: Effect.Effect<A, E>): Effect.Effect<A, E | HoldStalled | ReentrantCall>;
  standing(): readonly string[];
};

export const flight = Effect.fnUntraced(function* <K, A, E>(
  declaration: FlightDeclaration<K>,
): Effect.fn.Return<Flight<K, A, E>, never, Scope.Scope> {
  const ceilingMs = Duration.toMillis(declaration.ceiling);
  if (!(ceilingMs > 0) || ceilingMs > Duration.toMillis(CEILING_CAP)) {
    return yield* Effect.die(new ResourceInvalid({ resource: declaration.name, reason: 'its ceiling is not within 15 minutes' }));
  }
  const scope = yield* Effect.scope;
  const running = new Map<string, Deferred.Deferred<A, E>>();

  const join = Effect.fn('Flight.join')(function* (key: K, work: Effect.Effect<A, E>) {
    const id = declaration.key(key);
    const identity = `${declaration.name}:${id}`;
    const holding = yield* Holding;
    const holds = [
      ...liveHolds(holding).map((token) => `${token.resource}:${token.key}`),
      ...liveTickets(holding).map((ticket) => `ticket:${ticket.phase}`),
    ];
    if (holds.length > 0) return yield* Effect.die(new WaitUnderHold({ waitingOn: identity, holding: holds }));
    if ((yield* Origin).has(identity)) return yield* Effect.fail(new ReentrantCall({ resource: declaration.name, key: id }));
    let result = running.get(id);
    if (result === undefined) {
      const started = Deferred.makeUnsafe<A, E>();
      result = started;
      running.set(id, started);
      yield* Effect.forkIn(
        work.pipe(
          Effect.provideService(Holding, { tokens: [], tickets: [], within: [...holding.within, identity] }),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              running.delete(id);
              Deferred.doneUnsafe(started, exit);
            }),
          ),
        ),
        scope,
      );
    }
    const askedAt = yield* Clock.currentTimeMillis;
    const answered = yield* Effect.timeoutOption(Deferred.await(result), ceilingMs);
    if (Option.isSome(answered)) return answered.value;
    const waitedMs = (yield* Clock.currentTimeMillis) - askedAt;
    yield* stall({ resource: declaration.name, owner: declaration.owner, key: id, kind: 'wait-ceiling', ms: waitedMs });
    return yield* Effect.fail(new HoldStalled({ resource: declaration.name, key: id, outcome: 'none', waitedMs }));
  });

  return { declaration, join, standing: () => [...running.keys()] };
});
