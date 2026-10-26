import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';

export const monotonicMs: Effect.Effect<number> = Effect.map(Clock.monotonicTimeNanos, (nanos) => Number(nanos) / 1_000_000);
