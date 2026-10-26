import type { Track } from '@runlith/audio/sound/track';
import { type Cause, Effect, Fiber, Queue, Result, type Scope, Semaphore, Stream } from 'effect';
import type { Connection } from '../protocol/adapter.ts';
import { forkWatched } from '../protocol/watch.ts';
import type { SpeechFailure } from '../wire/failure.ts';
import type { Heard } from '../wire/heard.ts';
import { Hearing } from './hearing.ts';
import { makeSession, type Plan } from './session.ts';
import { type Detection, openDetection } from './SpeechDetector.ts';

export const listen = (
  plan: Plan,
  connect: Effect.Effect<Connection, SpeechFailure, Scope.Scope>,
  track: Track,
  detector: Effect.Effect<Detection, SpeechFailure, Scope.Scope> | undefined,
  cut?: Effect.Effect<void>,
): Stream.Stream<Heard, SpeechFailure> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const lock = yield* Semaphore.make(1);
      const out = yield* Queue.unbounded<Heard, SpeechFailure | Cause.Done>();
      let hearing: Hearing | undefined;
      if (detector !== undefined) {
        const opened = yield* openDetection(detector, plan.track, plan.origin);
        if (Result.isFailure(opened)) {
          yield* Queue.offer(out, opened.failure.gap);
          yield* Queue.fail(out, opened.failure.failure);
          return Stream.fromQueue(out);
        }
        hearing = new Hearing(opened.success, track.format, plan.settings.segmenter);
      }
      const session = makeSession({ plan, connect, hearing, source: track.format, scope, lock, out });
      const listening = hearing;
      const heard =
        listening === undefined
          ? undefined
          : yield* forkWatched(
              Effect.gen(function* () {
                const read = yield* Effect.result(
                  Stream.runForEach(listening.probabilities, (probabilities) => session.locked(session.hear(probabilities))),
                );
                if (Result.isFailure(read)) yield* session.locked(session.abort(read.failure));
              }),
              scope,
              out,
            );
      const loop = Effect.gen(function* () {
        yield* Stream.runForEach(track.chunks, (sound) => {
          if (sound._tag === 'Chunk') return session.locked(Effect.andThen(session.chunk(sound), session.detect(sound)));
          if (sound._tag === 'Gap') return session.locked(session.interrupt(sound));
          return Effect.void;
        });
        if (listening !== undefined && heard !== undefined) {
          const ended = yield* Effect.result(listening.end());
          if (Result.isFailure(ended)) return yield* session.locked(session.abort(ended.failure));
          yield* Fiber.join(heard);
        }
        yield* session.end();
      });
      yield* forkWatched(loop, scope, out);
      if (cut !== undefined) yield* forkWatched(Effect.andThen(cut, session.locked(session.sever())), scope, out);
      return Stream.fromQueue(out);
    }),
  );
