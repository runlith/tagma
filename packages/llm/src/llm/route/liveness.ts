import { Clock, Duration, Effect, Latch, Stream } from 'effect';
import { LLMError, StreamStalledReason } from '../schema/errors';
import type { LLMRequest } from '../schema/messages';

export const liveness = <A, R>(frames: Stream.Stream<A, LLMError, R>, request: LLMRequest): Stream.Stream<A, LLMError, R> => {
  const idleMs = request.liveness;
  if (idleMs === undefined) return frames;
  const stalled = new LLMError({
    module: 'LLM',
    method: 'stream',
    reason: new StreamStalledReason({
      message: `The model stream went silent: nothing arrived for ${Math.round(idleMs / 1000)} seconds.`,
      idleMs,
      url: String(request.model.id),
    }),
  });
  return Stream.unwrap(
    Clock.clockWith((clock) =>
      Effect.sync(() => {
        const awakeMs = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
        const pending = Latch.makeUnsafe(false);
        let deadline: number | undefined;
        const watched = Stream.transformPull(frames, (pull) =>
          Effect.succeed(
            Effect.suspend(() => {
              deadline = awakeMs() + idleMs;
              pending.openUnsafe();
              return pull;
            }).pipe(
              Effect.map((chunk) => {
                pending.closeUnsafe();
                deadline = undefined;
                return chunk;
              }),
            ),
          ),
        );
        const silence = Effect.gen(function* () {
          while (true) {
            yield* pending.await;
            if (deadline === undefined) continue;
            const remaining = deadline - awakeMs();
            if (remaining <= 0) return yield* Effect.fail(stalled);
            yield* clock.sleep(Duration.millis(remaining));
          }
        });
        return Stream.merge(watched, Stream.fromEffectDrain(silence), { haltStrategy: 'left' });
      }),
    ),
  );
};
