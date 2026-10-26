import { type Cause, Effect, Queue, type Scope, Stream } from 'effect';
import { type Format, framesOf, nanosOf } from './format.ts';
import { gap } from './gap.ts';
import type { Sound, Track } from './track.ts';

class Reader {
  private buffered = 0;
  private overflow: { from: bigint; to: bigint } | undefined;
  private gone = false;

  constructor(
    private readonly queue: Queue.Queue<Sound, Cause.Done>,
    private readonly format: Format,
    private readonly limit: number,
  ) {}

  get chunks(): Stream.Stream<Sound> {
    return Stream.fromQueue(this.queue).pipe(
      Stream.map((sound) => {
        if (sound._tag === 'Chunk') this.buffered -= framesOf(this.format, sound.pcm);
        return sound;
      }),
      Stream.ensuring(
        Effect.suspend(() => {
          this.gone = true;
          return Effect.asVoid(Queue.shutdown(this.queue));
        }),
      ),
    );
  }

  offer(sound: Sound): void {
    if (this.gone) return;
    if (sound._tag === 'Chunk') {
      const frames = framesOf(this.format, sound.pcm);
      if (this.buffered + frames > this.limit) {
        this.overflow = { from: this.overflow?.from ?? sound.at, to: sound.at + nanosOf(this.format, frames) };
        return;
      }
      this.flush();
      this.buffered += frames;
      Queue.offerUnsafe(this.queue, sound);
      return;
    }
    this.flush();
    Queue.offerUnsafe(this.queue, sound);
    if (sound._tag === 'Ended') Queue.endUnsafe(this.queue);
  }

  end(): void {
    if (this.gone) return;
    this.flush();
    Queue.endUnsafe(this.queue);
  }

  private flush(): void {
    if (this.overflow === undefined) return;
    Queue.offerUnsafe(this.queue, gap(this.overflow.from, this.overflow.to, 'overflow'));
    this.overflow = undefined;
  }
}

export const fanout = Effect.fnUntraced(function* (
  track: Track,
  readers: number,
  windowMs: number,
): Effect.fn.Return<readonly Track[], never, Scope.Scope> {
  const limit = Math.ceil((windowMs * track.format.rate) / 1000);
  const fanned = yield* Effect.forEach(Array.from({ length: readers }), () =>
    Effect.map(Queue.unbounded<Sound, Cause.Done>(), (queue) => new Reader(queue, track.format, limit)),
  );
  yield* Effect.forkScoped(
    Stream.runForEach(track.chunks, (sound) =>
      Effect.sync(() => {
        for (const reader of fanned) reader.offer(sound);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => fanned.forEach((reader) => reader.end())))),
  );
  return fanned.map((reader) => ({ format: track.format, chunks: reader.chunks, end: track.end }));
});
