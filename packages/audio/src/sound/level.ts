import type { Chunk } from './chunk.ts';
import { type Format, nanosOf } from './format.ts';

export type Level = {
  readonly at: bigint;
  readonly rms: number;
  readonly peak: number;
};

export class Meter {
  private readonly window: number;
  private squares = 0;
  private peak = 0;
  private count = 0;
  private start: bigint | undefined;

  constructor(
    private readonly format: Format,
    windowMs: number,
  ) {
    this.window = Math.max(1, Math.round((windowMs * format.rate) / 1000)) * format.channels;
  }

  push(input: Chunk): ReadonlyArray<Level> {
    const levels: Array<Level> = [];
    const pcm = input.pcm;
    for (let i = 0; i < pcm.length; i++) {
      if (this.count === 0) this.start = input.at + nanosOf(this.format, Math.floor(i / this.format.channels));
      const sample = pcm[i]! / 32768;
      this.squares += sample * sample;
      const magnitude = sample < 0 ? -sample : sample;
      if (magnitude > this.peak) this.peak = magnitude;
      this.count++;
      if (this.count === this.window) {
        levels.push({ at: this.start!, rms: Math.sqrt(this.squares / this.count), peak: this.peak });
        this.reset();
      }
    }
    return levels;
  }

  reset(): void {
    this.squares = 0;
    this.peak = 0;
    this.count = 0;
    this.start = undefined;
  }
}
