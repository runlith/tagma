import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { type Chunk, chunk } from './chunk.ts';
import { type Format, nanosOf } from './format.ts';
import { gap } from './gap.ts';
import { Resampler, resample } from './resampler.ts';
import { ended, type Sound, type Track } from './track.ts';

const mono = (rate: number): Format => ({ rate, channels: 1 });
const from = mono(48_000);
const to = mono(16_000);

const tone = (format: Format, frames: number): Int16Array => {
  const pcm = new Int16Array(frames);
  for (let i = 0; i < frames; i++) pcm[i] = Math.round(12_000 * Math.sin((2 * Math.PI * 440 * i) / format.rate));
  return pcm;
};

const joined = (chunks: ReadonlyArray<Chunk>): Int16Array => {
  const out = new Int16Array(chunks.reduce((sum, part) => sum + part.pcm.length, 0));
  let offset = 0;
  for (const part of chunks) {
    out.set(part.pcm, offset);
    offset += part.pcm.length;
  }
  return out;
};

const through = (input: Format, output: Format, at: bigint, parts: ReadonlyArray<Int16Array>): ReadonlyArray<Chunk> => {
  const resampler = new Resampler(input, output);
  const out: Array<Chunk> = [];
  let frames = 0;
  for (const part of parts) {
    const produced = resampler.push(chunk(input, at + nanosOf(input, frames), part));
    frames += part.length;
    if (produced !== undefined) out.push(produced);
  }
  const tail = resampler.flush();
  if (tail !== undefined) out.push(tail);
  return out;
};

const cut = (pcm: Int16Array, sizes: ReadonlyArray<number>): ReadonlyArray<Int16Array> => {
  const parts: Array<Int16Array> = [];
  for (let at = 0, i = 0; at < pcm.length; i++) {
    const size = Math.min(sizes[i % sizes.length]!, pcm.length - at);
    parts.push(pcm.subarray(at, at + size));
    at += size;
  }
  return parts;
};

const end = (format: Format, part: Chunk): bigint => part.at + nanosOf(format, part.pcm.length / format.channels);

describe('polyphase resampler', () => {
  test('the same input cut three ways gives the same output and duration', () => {
    const input = tone(from, 48_000);
    const whole = through(from, to, 0n, [input]);
    const even = through(from, to, 0n, cut(input, [480]));
    const ragged = through(from, to, 0n, cut(input, [1, 7, 4799, 311]));

    expect(joined(whole).length).toBe(16_000);
    expect(Array.from(joined(even))).toEqual(Array.from(joined(whole)));
    expect(Array.from(joined(ragged))).toEqual(Array.from(joined(whole)));
    expect(even[0]!.at).toBe(whole[0]!.at);
    expect(ragged[0]!.at).toBe(whole[0]!.at);
  });

  test('a segment keeps its bounds and an impulse keeps its time at a fractional ratio', () => {
    const input = mono(44_100);
    const start = 400_000_000n;
    const pcm = new Int16Array(11_025);
    pcm[4_410] = 30_000;
    const out = through(input, to, start, cut(pcm, [441]));
    const all = joined(out);
    let peak = 0;
    for (let i = 1; i < all.length; i++) if (all[i]! > all[peak]!) peak = i;

    expect(all.length).toBe(4_000);
    expect(out[0]!.at).toBe(start);
    expect(end(to, out.at(-1)!)).toBe(start + 250_000_000n);
    expect(Math.abs(Number(out[0]!.at + nanosOf(to, peak) - (start + 100_000_000n)))).toBeLessThanOrEqual(62_500);
  });

  it.effect('a gap drains the segment before it and resets the filter for the one after it', () =>
    Effect.gen(function* () {
      const first = tone(from, 4_800);
      const second = tone(from, 9_600);
      const track: Track = {
        format: from,
        end: Effect.void,
        chunks: Stream.fromIterable<Sound>([
          chunk(from, 0n, first),
          gap(100_000_000n, 400_000_000n, 'overflow'),
          chunk(from, 400_000_000n, second),
          ended('drained'),
        ]),
      };

      const sounds = yield* Stream.runCollect(resample(track, to).chunks);
      const at = sounds.findIndex((sound) => sound._tag === 'Gap');
      const before = sounds.slice(0, at).filter((sound): sound is Chunk => sound._tag === 'Chunk');
      const after = sounds.slice(at + 1).filter((sound): sound is Chunk => sound._tag === 'Chunk');
      const fresh = through(from, to, 400_000_000n, [second]);

      expect(end(to, before.at(-1)!)).toBe(100_000_000n);
      expect(after[0]!.at).toBe(400_000_000n);
      expect(Array.from(joined(after))).toEqual(Array.from(joined(fresh)));
      expect(sounds.at(-1)).toEqual(ended('drained'));
    }),
  );
});
