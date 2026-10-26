import { Cause, Effect, FiberMap, Semaphore, type Scope } from 'effect';

const USAGE_REFRESH_INTERVAL = '15 minutes';
const SCHEDULE_KEY = 'usage-refresh';
const BOOT_KEY = 'boot-refresh';

export type QuotaRefreshDriver = {
  readonly startWatching: Effect.Effect<void>;
  readonly stopWatching: Effect.Effect<void>;
};

const background = (name: string, work: Effect.Effect<void>): Effect.Effect<void> =>
  work.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.sync(() => console.warn(`[account-quota] ${name} failed`, Cause.pretty(cause))),
    ),
  );

export const quotaRefresh = Effect.fnUntraced(function* (refresh: Effect.Effect<void>) {
  const scheduled = yield* FiberMap.make<string, void>();
  const subscribersGate = Semaphore.makeUnsafe(1);
  const cycle = Effect.forever(
    Effect.sleep(USAGE_REFRESH_INTERVAL).pipe(Effect.andThen(refresh), (work) => background('scheduled refresh', work)),
  );
  let subscribers = 0;
  yield* FiberMap.run(scheduled, BOOT_KEY, { onlyIfMissing: true, startImmediately: true })(background('boot refresh', refresh));
  return {
    startWatching: subscribersGate.withPermit(
      Effect.gen(function* () {
        subscribers += 1;
        if (subscribers !== 1) return;
        yield* FiberMap.run(scheduled, SCHEDULE_KEY, { onlyIfMissing: true, startImmediately: true })(cycle);
      }),
    ),
    stopWatching: subscribersGate.withPermit(
      Effect.gen(function* () {
        subscribers = Math.max(0, subscribers - 1);
        if (subscribers === 0) yield* FiberMap.remove(scheduled, SCHEDULE_KEY);
      }),
    ),
  };
});
