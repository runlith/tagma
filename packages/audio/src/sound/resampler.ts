import { Stream } from 'effect';
import { type Chunk, chunk } from './chunk.ts';
import { type Format, framesOf } from './format.ts';
import type { Sound, Track } from './track.ts';

const TAPS = 64;
const WIDTH = TAPS + 1;
const LOOKAHEAD = TAPS / 2;
const ROLLOFF = 0.95;
const BETA = 9.0;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const bessel0 = (x: number): number => {
  let sum = 1;
  let term = 1;
  const half = x / 2;
  for (let k = 1; k < 64; k++) {
    term *= (half / k) * (half / k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
};

const tables = new Map<string, Float32Array>();

const polyphase = (up: number, down: number): Float32Array => {
  const key = `${up}:${down}`;
  const cached = tables.get(key);
  if (cached !== undefined) return cached;
  const length = up * TAPS + 1;
  const centre = (length - 1) / 2;
  const cutoff = (0.5 / Math.max(up, down)) * ROLLOFF;
  const norm = bessel0(BETA);
  const prototype = new Float64Array(length);
  let total = 0;
  for (let j = 0; j < length; j++) {
    const t = j - centre;
    const x = 2 * cutoff * t;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = t / centre;
    prototype[j] = 2 * cutoff * sinc * (bessel0(BETA * Math.sqrt(Math.max(0, 1 - r * r))) / norm);
    total += prototype[j]!;
  }
  const scale = up / total;
  const table = new Float32Array(up * WIDTH);
  for (let p = 0; p < up; p++) {
    for (let k = 0; p + k * up < length; k++) table[p * WIDTH + k] = prototype[p + k * up]! * scale;
  }
  tables.set(key, table);
  return table;
};

type Anchor = { readonly index: number; readonly at: bigint };

export class Resampler {
  private readonly up: number;
  private readonly down: number;
  private readonly table: Float32Array;
  private readonly channels: number;
  private buffer = new Int16Array(0);
  private base = 0;
  private filled = 0;
  private consumed = 0;
  private next = 0;
  private newest = 0;
  private phase = 0;
  private anchors: Array<Anchor> = [];

  constructor(
    readonly from: Format,
    readonly to: Format,
  ) {
    if (from.channels !== to.channels) {
      throw new RangeError(`a resampler keeps channels: ${from.channels} → ${to.channels}`);
    }
    const common = gcd(from.rate, to.rate);
    this.up = to.rate / common;
    this.down = from.rate / common;
    this.channels = from.channels;
    this.table = this.passes ? new Float32Array(0) : polyphase(this.up, this.down);
    this.reset();
  }

  get passes(): boolean {
    return this.up === 1 && this.down === 1;
  }

  push(input: Chunk): Chunk | undefined {
    if (this.passes) return input;
    const frames = framesOf(this.from, input.pcm);
    if (frames === 0) return undefined;
    this.anchors.push({ index: this.consumed, at: input.at });
    this.append(input.pcm, frames);
    this.consumed += frames;
    return this.produce(this.consumed);
  }

  flush(): Chunk | undefined {
    if (this.passes || this.consumed === 0) return undefined;
    const total = Math.ceil((this.consumed * this.up) / this.down);
    this.append(new Int16Array((LOOKAHEAD + 1) * this.channels), LOOKAHEAD + 1);
    const out = this.produce(Number.POSITIVE_INFINITY, total);
    this.reset();
    return out;
  }

  private produce(limit: number, total = Number.POSITIVE_INFINITY): Chunk | undefined {
    const channels = this.channels;
    const capacity = Math.max(0, Math.min(total - this.next, Math.ceil(((limit - this.newest) * this.up) / this.down) + 1));
    if (capacity === 0) return undefined;
    const out = new Int16Array(capacity * channels);
    const first = this.next;
    let produced = 0;
    while (this.newest < limit && this.next < total && produced < capacity) {
      const row = this.phase * WIDTH;
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        let at = (this.newest - this.base) * channels + c;
        for (let k = 0; k < WIDTH; k++, at -= channels) acc += this.table[row + k]! * this.buffer[at]!;
        const rounded = Math.round(acc);
        out[produced * channels + c] = rounded > 32767 ? 32767 : rounded < -32768 ? -32768 : rounded;
      }
      produced++;
      this.next++;
      const step = this.phase + this.down;
      this.newest += Math.floor(step / this.up);
      this.phase = step % this.up;
    }
    this.trim();
    if (produced === 0) return undefined;
    return chunk(this.to, this.timeOf(first), out.subarray(0, produced * channels));
  }

  private timeOf(n: number): bigint {
    const scaled = n * this.down;
    let anchor = this.anchors[0]!;
    for (const candidate of this.anchors) {
      if (candidate.index * this.up > scaled) break;
      anchor = candidate;
    }
    const offset = ((scaled - anchor.index * this.up) * 1_000_000_000) / (this.up * this.from.rate);
    return anchor.at + BigInt(Math.round(offset));
  }

  private append(pcm: Int16Array, frames: number): void {
    const channels = this.channels;
    const need = (this.filled + frames) * channels;
    if (need > this.buffer.length) {
      let size = Math.max(256, this.buffer.length);
      while (size < need) size *= 2;
      const grown = new Int16Array(size);
      grown.set(this.buffer.subarray(0, this.filled * channels));
      this.buffer = grown;
    }
    this.buffer.set(pcm, this.filled * channels);
    this.filled += frames;
  }

  private trim(): void {
    const drop = this.newest - TAPS - this.base;
    if (drop > 0) {
      const frames = Math.min(drop, this.filled);
      this.buffer.copyWithin(0, frames * this.channels, this.filled * this.channels);
      this.base += frames;
      this.filled -= frames;
    }
    const position = this.next * this.down;
    while (this.anchors.length > 1 && this.anchors[1]!.index * this.up <= position) this.anchors.shift();
  }

  reset(): void {
    const head = TAPS * this.channels;
    if (this.buffer.length < head) this.buffer = new Int16Array(head);
    this.buffer.fill(0, 0, head);
    this.base = -TAPS;
    this.filled = TAPS;
    this.consumed = 0;
    this.next = 0;
    this.newest = LOOKAHEAD;
    this.phase = 0;
    this.anchors = [];
  }
}

export const resample = (track: Track, to: Format): Track => {
  if (track.format.rate === to.rate && track.format.channels === to.channels) return track;
  return {
    format: to,
    end: track.end,
    chunks: Stream.suspend(() => {
      const resampler = new Resampler(track.format, to);
      return track.chunks.pipe(
        Stream.flatMap((sound): Stream.Stream<Sound> => {
          if (sound._tag === 'Chunk') {
            const out = resampler.push(sound);
            return out === undefined ? Stream.empty : Stream.succeed(out);
          }
          const tail = resampler.flush();
          return tail === undefined ? Stream.succeed(sound) : Stream.make<Array<Sound>>(tail, sound);
        }),
      );
    }),
  };
};
