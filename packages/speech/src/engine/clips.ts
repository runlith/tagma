import type { Chunk } from '@runlith/audio/sound/chunk';
import { type Format, framesOf } from '@runlith/audio/sound/format';
import { type Gap as AudioGap, type GapCause, lostSound } from '@runlith/audio/sound/gap';
import { Resampler } from '@runlith/audio/sound/resampler';
import type { Track } from '@runlith/audio/sound/track';
import { type Cause, Deferred, Effect, Fiber, Option, Queue, Result, type Scope, Semaphore, Stream } from 'effect';
import type { Clip } from '../protocol/adapter.ts';
import { forkWatched } from '../protocol/watch.ts';
import type { Limits } from '../wire/capabilities.ts';
import { SpeechEvent } from '../wire/events.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { Heard, Phase, Span, TrackState } from '../wire/heard.ts';
import { Hearing } from './hearing.ts';
import { Recording } from './recording.ts';
import type { Cut } from './segmenter.ts';
import { backoffMs, type ListeningSettings } from './settings.ts';
import { type Detection, openDetection } from './SpeechDetector.ts';
import { msOf, Timeline } from './timeline.ts';
import { Assembler, type Counter } from './turns.ts';

export type Clipping = {
  readonly track: string;
  readonly origin: bigint;
  readonly rate: number;
  readonly settings: ListeningSettings;
  readonly limits: Limits;
  readonly recorded: boolean;
};

const UNHEARD_MS = 2_000;

type Pending = {
  readonly clip: Clip;
  readonly segment: number;
  readonly timeline: Timeline;
  readonly start: number;
  readonly span: Span;
  readonly ms: number;
};

type Piece = Pending | 'end';

const clipLimitMs = (clipping: Clipping): number => {
  const byBytes = clipping.limits.clipBytes === undefined ? undefined : (clipping.limits.clipBytes / 2 / clipping.rate) * 1000;
  return Math.min(clipping.settings.segmenter.maxMs, clipping.limits.clipMs ?? Infinity, byBytes ?? Infinity);
};

const makeClipper = ({
  clipping,
  hearing,
  source,
  lock,
  out,
  pieces,
}: {
  readonly clipping: Clipping;
  readonly hearing: Hearing;
  readonly source: Format;
  readonly lock: Semaphore.Semaphore;
  readonly out: Queue.Queue<Heard, SpeechFailure | Cause.Done>;
  readonly pieces: Queue.Queue<Piece>;
}) => {
  const counter: Counter = { value: 0 };
  const format: Format = { rate: clipping.rate, channels: 1 };
  const toClip = new Resampler(source, format);
  let segment = 1;
  let timeline = new Timeline(clipping.rate, clipping.origin);
  let recording = new Recording();
  let hearingBase = 0;
  let queuedMs = 0;
  let failures = 0;
  let lost = false;
  let ended = false;
  let cutTo: number | undefined;
  let heardTo: number | undefined;
  let oldest: number | undefined;
  let starts: Array<number> = [];
  let reported = '';
  let moved = Deferred.makeUnsafe<void>();

  const locked = lock.withPermits(1);

  const room: Effect.Effect<void> = Effect.suspend(() => {
    if (!clipping.recorded || ended) return Effect.void;
    const queue = clipping.settings.clipQueueMs - clipLimitMs(clipping) - UNHEARD_MS;
    if (hearing.unheardMs <= UNHEARD_MS && queuedMs <= Math.max(0, queue)) return Effect.void;
    return Effect.andThen(Deferred.await(moved), room);
  });

  const move = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (!clipping.recorded) return Effect.void;
      const waiting = moved;
      moved = Deferred.makeUnsafe<void>();
      return Effect.asVoid(Deferred.succeed(waiting, undefined));
    });

  const emit = (heard: ReadonlyArray<Heard>): Effect.Effect<void> =>
    heard.length === 0 ? Effect.void : Effect.asVoid(Queue.offerAll(out, heard));

  const gap = (from: number, to: number | undefined, cause: GapCause, message: string): Heard => ({
    _tag: 'Gap',
    track: clipping.track,
    from,
    to,
    cause,
    message,
  });

  const report = (phase: Phase, retryInMs?: number): Effect.Effect<void> => {
    if (ended) return Effect.void;
    const state: TrackState = {
      _tag: 'State',
      track: clipping.track,
      phase,
      segment,
      retryInMs,
      queuedMs: Math.max(0, queuedMs),
    };
    const key = `${phase}:${state.segment}:${retryInMs}:${state.queuedMs}`;
    if (key === reported) return Effect.void;
    reported = key;
    return emit([state]);
  };

  const abort = Effect.fnUntraced(function* (failure: SpeechFailure, since?: number) {
    if (ended) return;
    ended = true;
    yield* move();
    const from = since ?? cutTo ?? timeline.start ?? heardTo;
    if (from !== undefined) yield* emit([gap(from, undefined, 'recognition-failed', failure.message)]);
    yield* Queue.fail(out, failure);
  });

  const sever = Effect.fnUntraced(function* () {
    if (ended) return;
    ended = true;
    yield* move();
    const from = cutTo ?? timeline.start ?? heardTo;
    const to = heardTo;
    if (from !== undefined && to !== undefined && to > from) {
      yield* emit([gap(from, to, 'unconfirmed-tail', 'recognition was cut before these clips were recognized')]);
    }
    yield* Queue.end(out);
  });

  const clipFrames = (detected: number): number => ((detected - hearingBase) * format.rate) / hearing.rate;

  const record = (flushed: Chunk | undefined): void => {
    if (flushed === undefined) return;
    timeline.record(flushed.at, flushed.pcm.length);
    recording.push(flushed.pcm);
  };

  const chunk = Effect.fnUntraced(function* (sound: Chunk) {
    if (ended) return;
    heardTo = msOf(clipping.origin, sound.at) + (framesOf(source, sound.pcm) * 1000) / source.rate;
    record(toClip.push(sound));
    const pushed = yield* Effect.result(hearing.push(sound));
    if (Result.isFailure(pushed)) return yield* abort(pushed.failure);
    const keep = Math.floor(clipFrames(hearing.reach));
    recording.trim(keep);
    timeline.forget(Math.min(keep, oldest ?? keep));
  });

  const queueClip = Effect.fnUntraced(function* (cut: Cut) {
    const from = clipFrames(cut.from);
    const to = clipFrames(cut.to);
    const pcm = recording.slice(from, to);
    recording.trim(to);
    if (pcm.length === 0) return;
    const span = { from: timeline.at(from), to: timeline.at(to) };
    cutTo = span.to;
    const ms = (pcm.length * 1000) / format.rate;
    if (queuedMs + ms > clipping.settings.clipQueueMs) {
      lost = true;
      return yield* emit([gap(span.from, span.to, 'budget', 'the recognizer fell behind the clip queue')]);
    }
    queuedMs += ms;
    const start = Math.floor(from);
    starts.push(start);
    oldest = starts[0];
    const clip: Clip = { format, pcm };
    yield* Queue.offer(pieces, { clip, segment, timeline, start, span, ms });
    yield* report('live');
  });

  const hear = Effect.fnUntraced(function* (cuts: ReadonlyArray<Cut>) {
    for (const cut of cuts) yield* queueClip(cut);
    yield* move();
  });

  const tails = Effect.fnUntraced(function* () {
    record(toClip.flush());
    const tail = yield* Effect.result(hearing.tail());
    if (Result.isFailure(tail)) yield* abort(tail.failure);
    return !ended;
  });

  const interrupt = Effect.fnUntraced(function* (sound: AudioGap) {
    if (ended || !(yield* tails())) return;
    yield* hear(hearing.settle());
    const reset = yield* Effect.result(hearing.reset());
    if (Result.isFailure(reset)) return yield* abort(reset.failure);
    const origin = clipping.origin;
    const to = sound.to === undefined ? undefined : msOf(origin, sound.to);
    yield* emit([gap(msOf(origin, sound.from), to, sound.cause, lostSound(sound.cause))]);
    segment += 1;
    timeline = new Timeline(format.rate, origin);
    recording = new Recording();
    hearingBase = hearing.frames;
    yield* report('live');
    starts = [];
    oldest = undefined;
  });

  const end = Effect.fnUntraced(function* () {
    if (ended) return;
    record(toClip.flush());
    yield* hear(hearing.settle());
    yield* Queue.offer(pieces, 'end');
  });

  const processed = (piece: Pending): void => {
    queuedMs -= piece.ms;
    if (piece.segment !== segment) return;
    starts.shift();
    oldest = starts[0];
  };

  const attempt = (
    piece: Pending,
    recognize: (clip: Clip) => Stream.Stream<SpeechEvent, SpeechFailure>,
  ): Effect.Effect<Result.Result<ReadonlyArray<SpeechEvent>, SpeechFailure>> =>
    recognize(piece.clip).pipe(
      Stream.runCollect,
      Effect.timeoutOption(clipping.settings.clipDeadlineMs),
      Effect.result,
      Effect.map((read) => {
        if (Result.isFailure(read)) return Result.fail(read.failure);
        return Option.isSome(read.success)
          ? Result.succeed(read.success.value)
          : Result.fail(SpeechFailure.transport('the recognizer did not answer the clip in time'));
      }),
    );

  const settled = Effect.fnUntraced(function* (piece: Pending, events: ReadonlyArray<SpeechEvent>) {
    const assembler = new Assembler(clipping.track, piece.segment, 'client', counter, clipping.settings.splitting, {
      time: (frame) => piece.timeline.at(piece.start + frame),
      commit: () => undefined,
      fallback: piece.span,
    });
    const heard = events.flatMap((event) => assembler.apply(event));
    yield* emit([...heard, ...assembler.closeAll()]);
    failures = 0;
    lost = false;
    processed(piece);
    yield* move();
    yield* report('live');
  });

  const work = Effect.fnUntraced(function* (recognize: (clip: Clip) => Stream.Stream<SpeechEvent, SpeechFailure>) {
    const retry = clipping.settings.retry;
    while (!ended) {
      const piece = yield* Queue.take(pieces);
      if (piece === 'end') {
        return yield* locked(
          Effect.gen(function* () {
            if (ended) return;
            ended = true;
            yield* move();
            if (!lost) yield* emit([SpeechEvent.finished]);
            yield* Queue.end(out);
          }),
        );
      }
      while (!ended) {
        const read = yield* attempt(piece, recognize);
        if (Result.isSuccess(read)) {
          yield* locked(settled(piece, read.success));
          break;
        }
        failures += 1;
        const failure = read.failure;
        if (!failure.retryable || failures > retry.attempts) {
          yield* locked(
            Effect.andThen(
              Effect.sync(() => processed(piece)),
              abort(failure, piece.span.from),
            ),
          );
          return;
        }
        const delay = backoffMs(retry, failures, failure.retryAfterMs);
        yield* locked(report('waiting', delay));
        yield* Effect.sleep(delay);
      }
    }
  });

  return { locked, room, report, abort, sever, chunk, hear, interrupt, end, work };
};

export const clips = (
  clipping: Clipping,
  track: Track,
  detector: Effect.Effect<Detection, SpeechFailure, Scope.Scope>,
  recognize: (clip: Clip) => Stream.Stream<SpeechEvent, SpeechFailure>,
  cut?: Effect.Effect<void>,
): Stream.Stream<Heard, SpeechFailure> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const out = yield* Queue.unbounded<Heard, SpeechFailure | Cause.Done>();
      const opened = yield* openDetection(detector, clipping.track, clipping.origin);
      if (Result.isFailure(opened)) {
        yield* Queue.offer(out, opened.failure.gap);
        yield* Queue.fail(out, opened.failure.failure);
        return Stream.fromQueue(out);
      }
      const settings = { ...clipping.settings.segmenter, maxMs: clipLimitMs(clipping) };
      const hearing = new Hearing(opened.success, track.format, settings);
      const pieces = yield* Queue.unbounded<Piece>();
      const clipper = makeClipper({ clipping, hearing, source: track.format, lock: yield* Semaphore.make(1), out, pieces });
      const heard = yield* forkWatched(
        Effect.gen(function* () {
          const read = yield* Effect.result(
            Stream.runForEach(hearing.probabilities, (probabilities) => clipper.locked(clipper.hear(hearing.hear(probabilities)))),
          );
          if (Result.isFailure(read)) yield* clipper.locked(clipper.abort(read.failure));
        }),
        scope,
        out,
      );
      const listening = Effect.gen(function* () {
        yield* Stream.runForEach(track.chunks, (sound) => {
          if (sound._tag === 'Chunk') return Effect.andThen(clipper.room, clipper.locked(clipper.chunk(sound)));
          if (sound._tag === 'Gap') return clipper.locked(clipper.interrupt(sound));
          return Effect.void;
        });
        const ended = yield* Effect.result(hearing.end());
        if (Result.isFailure(ended)) return yield* clipper.locked(clipper.abort(ended.failure));
        yield* Fiber.join(heard);
        yield* clipper.locked(clipper.end());
      });
      yield* clipper.locked(clipper.report('live'));
      yield* forkWatched(clipper.work(recognize), scope, out);
      yield* forkWatched(listening, scope, out);
      if (cut !== undefined) yield* forkWatched(Effect.andThen(cut, clipper.locked(clipper.sever())), scope, out);
      return Stream.fromQueue(out);
    }),
  );
