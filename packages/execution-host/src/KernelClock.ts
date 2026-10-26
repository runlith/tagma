import { Clock, Effect } from 'effect';

export const kernelClock = (uptimeNanos: () => bigint): Effect.Effect<Clock.Clock> =>
  Clock.clockWith((base) =>
    Effect.succeed<Clock.Clock>({
      currentTimeMillisUnsafe: () => base.currentTimeMillisUnsafe(),
      currentTimeMillis: base.currentTimeMillis,
      currentTimeNanosUnsafe: () => base.currentTimeNanosUnsafe(),
      currentTimeNanos: base.currentTimeNanos,
      monotonicTimeNanosUnsafe: uptimeNanos,
      monotonicTimeNanos: Effect.sync(uptimeNanos),
      sleep: (duration) => base.sleep(duration),
    }),
  );
