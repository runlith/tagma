import { chunk } from '@runlith/audio/sound/chunk';
import { captureFormat, nanosOf } from '@runlith/audio/sound/format';
import { type GapCause, gap } from '@runlith/audio/sound/gap';
import { type EndReason, ended, type Sound, type Track } from '@runlith/audio/sound/track';
import { type Cause, Clock, Deferred, Effect, Exit, Fiber, Queue, type Scope, Stream } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Sent } from '../contract/service/recognitions.js';
import { type ListeningTrack, SENT_FRAME_SAMPLES as FRAME_SAMPLES, SENT_HEADER_BYTES as HEADER_BYTES } from '../contract/wire/listening.js';
import { VOICE_WORDS } from '../contract/wire/words.js';
import type { Captured } from './track.js';

const FRAME_BYTES = HEADER_BYTES + FRAME_SAMPLES * 2;
const FIRST_FRAME_MS = 5_000;
const LAST_FRAME_MS = 2_000;
const BUFFERED_MS = 10_000;

const frameNanos = nanosOf(captureFormat, FRAME_SAMPLES);
const BUFFERED_FRAMES = Math.ceil((BUFFERED_MS * 1_000_000) / Number(frameNanos));

const refused = (reason: string): GateRefusal<'sender-refused'> =>
  new GateRefusal('sender-refused', reason, ['start the dictation again']).saying(VOICE_WORDS.dictationLost);

type Missed = { readonly from: bigint; to: bigint; readonly cause: GapCause };

class Line {
  readonly stopped = Deferred.makeUnsafe<EndReason>();
  readonly asked = Deferred.makeUnsafe<void>();
  attached = false;
  private next = 0;
  private last: number | null = null;
  private finishing = false;
  private closed = false;
  private whole = true;
  private missed: Missed | undefined;
  private tail: readonly Sound[] = [];

  constructor(
    private readonly opened: bigint,
    private readonly sounds: Queue.Queue<Sound, Cause.Done>,
  ) {}

  get lossless(): boolean {
    return this.whole;
  }

  get ended(): boolean {
    return this.closed;
  }

  get started(): boolean {
    return this.next > 0 || this.last !== null;
  }

  get chunks(): Stream.Stream<Sound> {
    return Stream.concat(
      Stream.fromQueue(this.sounds),
      Stream.suspend(() => Stream.fromIterable(this.tail)),
    );
  }

  push(bytes: Uint8Array): Effect.Effect<void, GateRefusal<'sender-refused'>> {
    return Effect.suspend(() => {
      if (this.closed) return Effect.void;
      if (bytes.length !== FRAME_BYTES && bytes.length !== HEADER_BYTES) {
        return Effect.fail(refused(`the page sent a sound frame of ${bytes.length} bytes, where each holds ${FRAME_BYTES}`));
      }
      const seq = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES).getUint32(0, true);
      if (bytes.length === HEADER_BYTES) {
        this.last = seq;
        if (this.finishing) this.close('drained');
        return Effect.void;
      }
      if (seq < this.next || (this.last !== null && seq >= this.last)) return Effect.void;
      if (seq > this.next) this.emit(gap(this.at(this.next), this.at(seq), 'transport'));
      const start = bytes.byteOffset + HEADER_BYTES;
      const pcm = start % 2 === 0 ? new Int16Array(bytes.buffer, start, FRAME_SAMPLES) : new Int16Array(bytes.slice(HEADER_BYTES).buffer);
      this.emit(chunk(captureFormat, this.at(seq), pcm));
      this.next = seq + 1;
      return Effect.void;
    });
  }

  finish(): void {
    if (this.closed) return;
    this.finishing = true;
    if (this.last !== null) this.close('drained');
    else Deferred.doneUnsafe(this.asked, Exit.void);
  }

  close(reason: EndReason): void {
    if (this.closed) return;
    this.closed = true;
    const tail: Sound[] = [];
    if (reason !== 'drained' || this.last === null || this.last > this.next) this.whole = false;
    if (this.missed !== undefined) tail.push(gap(this.missed.from, this.missed.to, this.missed.cause));
    if (reason === 'sender-lost' || (reason === 'drained' && this.last === null))
      tail.push(gap(this.at(this.next), undefined, 'transport'));
    else if (reason === 'drained' && this.last !== null && this.last > this.next)
      tail.push(gap(this.at(this.next), this.at(this.last), 'transport'));
    tail.push(ended(reason));
    this.tail = tail;
    this.missed = undefined;
    Queue.endUnsafe(this.sounds);
    Deferred.doneUnsafe(this.stopped, Exit.succeed(reason));
  }

  private emit(sound: Sound & { readonly _tag: 'Chunk' | 'Gap' }): void {
    if (sound._tag === 'Gap') this.whole = false;
    if (this.missed !== undefined) {
      if (!Queue.offerUnsafe(this.sounds, gap(this.missed.from, this.missed.to, this.missed.cause))) return this.miss(sound);
      this.missed = undefined;
    }
    if (!Queue.offerUnsafe(this.sounds, sound)) this.miss(sound);
  }

  private miss(sound: Sound & { readonly _tag: 'Chunk' | 'Gap' }): void {
    this.whole = false;
    const from = sound._tag === 'Chunk' ? sound.at : sound.from;
    const to = sound._tag === 'Chunk' ? sound.at + frameNanos : (sound.to ?? sound.from);
    if (this.missed === undefined) this.missed = { from, to, cause: sound._tag === 'Chunk' ? 'overflow' : sound.cause };
    else this.missed.to = to;
  }

  private at(seq: number): bigint {
    return this.opened + BigInt(seq) * frameNanos;
  }
}

export type Senders = Effect.Success<typeof makeSenders>;

export const makeSenders = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const open = new Map<string, Line>();
  const early = new Map<string, Deferred.Deferred<Line>>();
  const track = Effect.fn('Senders.track')(function* (
    recognition: string,
    track: ListeningTrack,
  ): Effect.fn.Return<Captured, never, Scope.Scope> {
    const key = `${recognition}/${track.id}`;

    const sender = yield* Effect.acquireRelease(
      Effect.map(Queue.bounded<Sound, Cause.Done>(BUFFERED_FRAMES), (sounds) => {
        const made = new Line(clock.monotonicTimeNanosUnsafe(), sounds);
        open.set(key, made);
        const waiting = early.get(key);
        if (waiting !== undefined) {
          early.delete(key);
          made.attached = true;
          Deferred.doneUnsafe(waiting, Exit.succeed(made));
        }
        return made;
      }),
      (made) =>
        Effect.sync(() => {
          if (open.get(key) === made) open.delete(key);
          made.close('aborted');
        }),
    );
    yield* Effect.forkScoped(
      Effect.andThen(
        Effect.sleep(FIRST_FRAME_MS),
        Effect.sync(() => (sender.started ? undefined : sender.close('sender-lost'))),
      ),
    );
    yield* Effect.forkScoped(
      Deferred.await(sender.asked).pipe(
        Effect.andThen(Effect.sleep(LAST_FRAME_MS)),
        Effect.andThen(Effect.sync(() => sender.close('drained'))),
      ),
    );
    const sent: Track = { format: captureFormat, chunks: sender.chunks, end: Effect.sync(() => sender.finish()) };
    return { track, capture: sent };
  });

  const send = <E>(
    recognition: string,
    track: string,
    frames: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<Sent, GateRefusal<'sender-refused'> | E> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(restore(line(recognition, track)), (sender) =>
        restore(read(sender, frames)).pipe(Effect.ensuring(Effect.sync(() => sender.close('sender-lost')))),
      ),
    );

  const read = Effect.fn('Senders.read')(function* <E>(
    line: Line,
    frames: Stream.Stream<Uint8Array, E>,
  ): Effect.fn.Return<Sent, GateRefusal<'sender-refused'> | E> {
    const outcome = (reason: EndReason): Sent => (reason === 'drained' && line.lossless ? 'finished' : 'lost');
    const reading = yield* Effect.forkChild(Stream.runForEach(frames, (bytes) => line.push(bytes)));
    const first = yield* Effect.raceFirst(
      Effect.map(Fiber.await(reading), (exit) => ({ read: exit })),
      Effect.map(Deferred.await(line.stopped), (reason) => ({ reason })),
    );
    if ('reason' in first) {
      yield* Fiber.interrupt(reading);
      return outcome(first.reason);
    }
    const settled = line.ended;
    line.close('sender-lost');
    if (Exit.isFailure(first.read) && !settled) return yield* Effect.failCause(first.read.cause);
    return outcome(yield* Deferred.await(line.stopped));
  });

  const line = (recognition: string, track: string): Effect.Effect<Line, GateRefusal<'sender-refused'>> => {
    const key = `${recognition}/${track}`;
    const taken = refused(`another page already sends the sound of this dictation`);
    return Effect.suspend(() => {
      const standing = open.get(key);
      if (standing !== undefined) {
        if (standing.attached) return Effect.fail(taken);
        standing.attached = true;
        return Effect.succeed(standing);
      }
      if (early.has(key)) return Effect.fail(taken);
      const waiting = Deferred.makeUnsafe<Line>();
      early.set(key, waiting);
      return Deferred.await(waiting).pipe(
        Effect.timeoutOrElse({
          duration: FIRST_FRAME_MS,
          orElse: () =>
            Effect.suspend(() => {
              if (early.get(key) === waiting) early.delete(key);
              return Effect.fail(refused('the dictation this sound belongs to is no longer open on the server'));
            }),
        }),
        Effect.onInterrupt(() => Effect.sync(() => early.get(key) === waiting && early.delete(key))),
      );
    });
  };
  return { track, send };
});
