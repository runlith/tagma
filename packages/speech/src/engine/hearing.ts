import type { Chunk } from '@runlith/audio/sound/chunk';
import { type Format, framesOf } from '@runlith/audio/sound/format';
import { Resampler } from '@runlith/audio/sound/resampler';
import { Effect } from 'effect';
import type { SpeechFailure } from '../wire/failure.ts';
import { type Cut, feed, flush, quiet, reach, type Segmenter, type SegmenterSettings, type SegmenterState } from './segmenter.ts';
import type { Detection, Probabilities } from './SpeechDetector.ts';

export class Hearing {
  private readonly resampler: Resampler;
  private readonly segmenter: Segmenter;
  private state: SegmenterState = quiet(0);
  private pushed = 0;
  private evaluated = 0;

  constructor(
    private readonly detection: Detection,
    source: Format,
    settings: SegmenterSettings,
  ) {
    this.resampler = new Resampler(source, detection.format);
    this.segmenter = { settings, rate: detection.format.rate, window: detection.window };
  }

  get rate(): number {
    return this.segmenter.rate;
  }

  get frames(): number {
    return this.pushed;
  }

  get unheardMs(): number {
    return (Math.max(0, this.pushed - this.evaluated) * 1000) / this.segmenter.rate;
  }

  get speaking(): boolean {
    return this.state.phase === 'speech';
  }

  get reach(): number {
    return reach(this.segmenter, this.state, this.evaluated);
  }

  get probabilities() {
    return this.detection.probabilities;
  }

  push(sound: Chunk): Effect.Effect<void, SpeechFailure> {
    return this.send(this.resampler.push(sound));
  }

  tail(): Effect.Effect<void, SpeechFailure> {
    return this.send(this.resampler.flush());
  }

  hear(probabilities: Probabilities): ReadonlyArray<Cut> {
    const [state, cuts] = feed(this.segmenter, this.state, probabilities.at, probabilities.values);
    this.state = state;
    this.evaluated = Math.max(this.evaluated, probabilities.at + probabilities.values.length * this.segmenter.window);
    return cuts;
  }

  settle(): ReadonlyArray<Cut> {
    const [state, cuts] = flush(this.state, this.pushed);
    this.state = state;
    return cuts;
  }

  reset(): Effect.Effect<void, SpeechFailure> {
    return Effect.andThen(
      this.detection.reset,
      Effect.sync(() => {
        this.state = quiet(this.pushed);
        this.evaluated = this.pushed;
      }),
    );
  }

  end(): Effect.Effect<void, SpeechFailure> {
    return Effect.andThen(this.tail(), this.detection.end);
  }

  private send(out: Chunk | undefined): Effect.Effect<void, SpeechFailure> {
    if (out === undefined) return Effect.void;
    this.pushed += framesOf(this.detection.format, out.pcm);
    return this.detection.push(out.pcm);
  }
}
