import type { Availability } from '@runlith/audio/port/devices';
import type { Format } from '@runlith/audio/sound/format';
import { type Cause, Effect, Layer, Queue, Stream } from 'effect';
import { type Detection, type Probabilities, SpeechDetector } from '../engine/SpeechDetector.ts';
import type { SpeechFailure } from '../wire/failure.ts';

export type FakeDetector = {
  readonly format?: Format | undefined;
  readonly window?: number | undefined;
  readonly probability?: ((pcm: Int16Array) => number) | undefined;
};

const loudness = (pcm: Int16Array): number => {
  let total = 0;
  for (const sample of pcm) total += Math.abs(sample);
  return pcm.length === 0 ? 0 : total / pcm.length;
};

const speechLike = (pcm: Int16Array): number => (loudness(pcm) > 1_000 ? 0.9 : 0.05);

export const fakeDetector = (fake: FakeDetector = {}): Layer.Layer<SpeechDetector> => {
  const format = fake.format ?? { rate: 16_000, channels: 1 };
  const window = fake.window ?? 320;
  const probability = fake.probability ?? speechLike;
  const open = Effect.gen(function* () {
    const probabilities = yield* Queue.unbounded<Probabilities, SpeechFailure | Cause.Done>();
    let partial = new Int16Array(0);
    let next = 0;
    const take = (final: boolean) => {
      const values: Array<number> = [];
      const at = next;
      let offset = 0;
      while (partial.length - offset >= window || (final && partial.length - offset > 0)) {
        const piece = partial.subarray(offset, Math.min(partial.length, offset + window));
        values.push(probability(piece));
        offset += piece.length;
        next += window;
      }
      partial = partial.slice(offset);
      return values.length === 0 ? Effect.void : Effect.asVoid(Queue.offer(probabilities, { at, values }));
    };
    const detection: Detection = {
      format,
      window,
      push: (pcm) =>
        Effect.suspend(() => {
          const joined = new Int16Array(partial.length + pcm.length);
          joined.set(partial);
          joined.set(pcm, partial.length);
          partial = joined;
          return take(false);
        }),
      reset: Effect.sync(() => {
        next += partial.length;
        partial = new Int16Array(0);
      }),
      end: Effect.andThen(
        Effect.suspend(() => take(true)),
        Queue.end(probabilities),
      ),
      probabilities: Stream.fromQueue(probabilities),
    };
    return detection;
  });
  const present: Availability = { _tag: 'present' };
  return Layer.succeed(SpeechDetector, { availability: Effect.succeed(present), open });
};
