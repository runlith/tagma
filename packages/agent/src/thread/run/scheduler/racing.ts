import { Effect } from 'effect';

const RACE_ATTEMPTS = 2;

export function racing<S, A, E, R>(
  first: S,
  attempt: (state: S, again: Effect.Effect<A, E, R> | null) => Effect.Effect<A, E, R>,
  refresh: (state: S) => Effect.Effect<S, E, R> = Effect.succeed,
): Effect.Effect<A, E, R> {
  const round = (state: S, made: number): Effect.Effect<A, E, R> =>
    attempt(state, made < RACE_ATTEMPTS ? Effect.flatMap(refresh(state), (next) => round(next, made + 1)) : null);
  return round(first, 1);
}
