import type { Availability } from '@runlith/audio/port/devices';
import type { Format } from '@runlith/audio/sound/format';
import { Clock, Context, Effect, Layer, Result, type Scope, type Stream } from 'effect';
import { SpeechFailure } from '../wire/failure.ts';
import type { Gap } from '../wire/heard.ts';
import { msOf } from './timeline.ts';

export type Probabilities = {
  readonly at: number;
  readonly values: ReadonlyArray<number>;
};

export const openDetection = Effect.fnUntraced(function* (
  detector: Effect.Effect<Detection, SpeechFailure, Scope.Scope>,
  track: string,
  origin: bigint,
): Effect.fn.Return<Result.Result<Detection, { readonly gap: Gap; readonly failure: SpeechFailure }>, never, Scope.Scope> {
  const since = msOf(origin, yield* Clock.monotonicTimeNanos);
  const result = yield* Effect.result(detector);
  if (Result.isSuccess(result)) return Result.succeed(result.success);
  const failure = result.failure;
  const message = `the voice detector did not open: ${failure.message}`;
  return Result.fail({ failure, gap: { _tag: 'Gap', track, from: since, to: undefined, cause: 'recognition-failed', message } as const });
});

export type Detection = {
  readonly format: Format;
  readonly window: number;
  readonly push: (pcm: Int16Array) => Effect.Effect<void, SpeechFailure>;
  readonly reset: Effect.Effect<void, SpeechFailure>;
  readonly end: Effect.Effect<void, SpeechFailure>;
  readonly probabilities: Stream.Stream<Probabilities, SpeechFailure>;
};

export class SpeechDetector extends Context.Service<
  SpeechDetector,
  {
    readonly availability: Effect.Effect<Availability>;
    readonly open: Effect.Effect<Detection, SpeechFailure, Scope.Scope>;
  }
>()('speech/SpeechDetector') {
  static none(reason: string, unblock: ReadonlyArray<string> = []): Layer.Layer<SpeechDetector> {
    const absent: Availability = { _tag: 'absent', reason, unblock };
    return Layer.succeed(SpeechDetector, {
      availability: Effect.succeed(absent),
      open: Effect.fail(SpeechFailure.unsupported(reason)),
    });
  }
}
