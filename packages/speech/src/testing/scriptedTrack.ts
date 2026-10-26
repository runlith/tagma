import { chunk } from '@runlith/audio/sound/chunk';
import { type Format, framesOf, nanosOf } from '@runlith/audio/sound/format';
import { type GapCause, gap } from '@runlith/audio/sound/gap';
import { ended, type Sound, type Track } from '@runlith/audio/sound/track';
import { type Cause, Effect, Queue, Stream } from 'effect';

export type ScriptedTrack = {
  readonly track: Track;
  readonly play: (pcm: Int16Array) => Effect.Effect<void>;
  readonly skip: (ms: number, cause: GapCause) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
};

export const scriptedTrack = Effect.fnUntraced(function* (format: Format): Effect.fn.Return<ScriptedTrack> {
  const sounds = yield* Queue.unbounded<Sound, Cause.Done>();
  let at = 0n;
  const close = Effect.andThen(Queue.offer(sounds, ended('drained')), Queue.end(sounds));
  return {
    track: { format, chunks: Stream.fromQueue(sounds), end: Effect.asVoid(close) },
    play: (pcm) =>
      Effect.suspend(() => {
        const sound = chunk(format, at, pcm);
        at += nanosOf(format, framesOf(format, pcm));
        return Effect.asVoid(Queue.offer(sounds, sound));
      }),
    skip: (ms, cause) =>
      Effect.suspend(() => {
        const from = at;
        at += BigInt(ms) * 1_000_000n;
        return Effect.asVoid(Queue.offer(sounds, gap(from, at, cause)));
      }),
    close: Effect.asVoid(close),
  };
});
