import { Clock, Effect } from 'effect';
import { GuestUnavailable } from './wire.js';

const IDLE_MS = 15_000;

export const transfer = Effect.fn('sandbox.transfer')(function* <A, E, R>(
  container: string,
  work: (progress: Effect.Effect<void>) => Effect.Effect<A, E, R>,
): Effect.fn.Return<A, E | GuestUnavailable, R> {
  let advanced = yield* Clock.currentTimeMillis;
  const progress = Clock.currentTimeMillis.pipe(
    Effect.map((now) => {
      advanced = now;
    }),
  );
  const stalled = Effect.gen(function* () {
    for (;;) {
      const remaining = IDLE_MS - ((yield* Clock.currentTimeMillis) - advanced);
      if (remaining <= 0) {
        return yield* new GuestUnavailable({ container, reason: 'the archive transfer made no progress for 15 seconds' });
      }
      yield* Effect.sleep(remaining);
    }
  });
  return yield* Effect.raceFirst(work(progress), stalled);
});
