import { Data, Effect, Option } from 'effect';

const ATTEMPT_MS = 15_000;
const PAUSE_MS = 2_000;
export const WARMUP_MS = 120_000;

class OriginSilent extends Data.TaggedError('OriginSilent')<{ readonly reason: string }> {}

const ask = (url: string): Effect.Effect<void, OriginSilent> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_MS)]),
      });
      await response.body?.cancel();
    },
    catch: (cause) => new OriginSilent({ reason: cause instanceof Error ? cause.message : String(cause) }),
  });

const answered = (url: string): Effect.Effect<void> =>
  Effect.catchTag(ask(url), 'OriginSilent', () => Effect.andThen(Effect.sleep(PAUSE_MS), answered(url)));

export const originAnswers = Effect.fn('tailscale.warmup')(function* (origin: string) {
  return Option.isSome(yield* Effect.timeoutOption(answered(`${origin}/health`), WARMUP_MS));
});
