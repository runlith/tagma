import { SpeechDetector } from '@runlith/speech/engine/SpeechDetector';
import { Effect, Layer, Stream } from 'effect';
import { Engine } from './engine/Engine.ts';
import { speechFailure } from './failures.ts';

export const detectorLayer: Layer.Layer<SpeechDetector, never, Engine> = Layer.effect(
  SpeechDetector,
  Effect.gen(function* () {
    const engine = yield* Engine;
    return SpeechDetector.of({
      availability: Effect.succeed({ _tag: 'present' }),
      open: Effect.map(Effect.mapError(engine.detect, speechFailure), (detection) => ({
        format: { rate: detection.rate, channels: 1 },
        window: detection.window,
        push: (pcm: Int16Array) => Effect.mapError(detection.push(pcm), speechFailure),
        reset: Effect.mapError(detection.reset, speechFailure),
        end: Effect.mapError(detection.end, speechFailure),
        probabilities: detection.probs.pipe(
          Stream.map((probs) => ({ at: probs.at, values: probs.probs })),
          Stream.mapError(speechFailure),
        ),
      })),
    });
  }),
);
