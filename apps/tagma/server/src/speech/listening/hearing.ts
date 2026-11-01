import { AudioDevices } from '@runlith/audio/port/devices';
import { Speech } from '@runlith/speech/engine/Speech';
import { type Cause, Clock, Deferred, Effect, Fiber, Queue, type Scope, Stream } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Settings } from '../../settings/contract/service/values.js';
import type { Captures } from '../contract/service/captures.js';
import { type HearAsk, Recognitions, type StartRefusal } from '../contract/service/recognitions.js';
import type { Heard } from '../contract/wire/listening.js';
import { dictationRecognizer, microphone } from '../keys.js';
import { chosen, listeningSettings } from './choice.js';
import { heardOf, voiceKey, voiceOf } from './convert.js';
import { makeSenders } from './sending.js';
import { capture, type Captured, type Ears, listened, named, recognized } from './track.js';

const HEARD_CAPACITY = 4_096;

const SLOWEST_TAIL_MS = 15_000;

const RECOGNITION = 'recognition';

export const unknownRecognition = (id: string): GateRefusal<'unknown-recognition'> =>
  new GateRefusal('unknown-recognition', `no recognition ${id} is open on this server`, [
    'finish a recognition while its speech.recognize feed is still subscribed',
  ]);

type Registered = {
  readonly captured: readonly Captured[];
  readonly scope: Scope.Scope;
  readonly cut: Effect.Effect<void>;
};

type Open = {
  readonly ready: Deferred.Deferred<Registered | undefined>;
  finishing: boolean;
};

export const makeRecognitions = Effect.fnUntraced(function* ({ captures }: { readonly captures: Captures['Service'] }) {
  const speech = yield* Speech;
  const devices = yield* AudioDevices;
  const settings = yield* Settings;
  const clock = yield* Clock.Clock;
  const senders = yield* makeSenders;
  const open = new Map<string, Open>();
  const admitted = (id: string): Effect.Effect<Open, GateRefusal<'track-invalid'>, Scope.Scope> =>
    Effect.acquireRelease(
      Effect.suspend(() => {
        if (open.has(id)) {
          return Effect.fail(
            new GateRefusal('track-invalid', `recognition ${id} is already open`, ['choose a new id for each recognition']),
          );
        }
        const entry: Open = { ready: Deferred.makeUnsafe<Registered | undefined>(), finishing: false };
        open.set(id, entry);
        return Effect.succeed(entry);
      }),
      (entry) =>
        Effect.suspend(() => {
          if (open.get(id) === entry) open.delete(id);
          return Effect.andThen(captures.end(RECOGNITION, id), Effect.asVoid(Deferred.succeed(entry.ready, undefined)));
        }),
    );

  const recognize = (ask: HearAsk): Stream.Stream<Heard, GateRefusal<StartRefusal> | StoreFailure> =>
    Stream.unwrap(
      Effect.gen(function* () {
        if (ask.tracks.length === 0) {
          return yield* new GateRefusal('track-invalid', 'recognition captures at least one track', ['name a mic or a system track']);
        }
        if (ask.tracks.some((track) => track.at === 'caller' && track.source !== 'mic')) {
          return yield* new GateRefusal('track-invalid', 'a caller sends only its microphone', ['ask system audio at: server']);
        }
        const entry = yield* admitted(ask.id);
        const tracks = named(ask.tracks, yield* settings.value(microphone));
        const { choice, recognizer } = yield* chosen(
          speech,
          settings,
          ask.recognizer,
          ask.purpose === 'dictation' ? dictationRecognizer : undefined,
        );
        const tuned = yield* listeningSettings(settings);
        const origin = clock.monotonicTimeNanosUnsafe();
        const captured = yield* Effect.forEach(tracks, (track, index) =>
          ask.tracks[index]?.at === 'caller' ? senders.track(ask.id, track) : capture(devices, track),
        );
        const out = yield* Queue.sliding<Heard, Cause.Done>(HEARD_CAPACITY);
        const sources = new Map(tracks.map((track) => [track.id, track.source]));
        const numbers = new Map<string, number>();
        const speakerOf = (spoken: Parameters<Ears<never>['spoken']>[0]): number | null => {
          if (spoken._tag !== 'Utterance' || sources.get(spoken.id.track) === 'mic') return null;
          const key = voiceKey(voiceOf(spoken, 0, recognizer.speakers));
          const known = numbers.get(key);
          if (known !== undefined) return known;
          numbers.set(key, numbers.size + 1);
          return numbers.size;
        };
        const ears: Ears<never> = {
          heard: (heard) => Effect.asVoid(Queue.offer(out, heard)),
          spoken: (spoken) => Effect.asVoid(Queue.offer(out, heardOf(spoken, 0, speakerOf(spoken)))),
        };
        const fibers = yield* Effect.forEach(captured, (one) =>
          Effect.forkScoped(recognized(speech, choice, listened(one, origin, ears), origin, tuned, recognizer.account, ears)),
        );
        yield* Effect.forkScoped(Effect.andThen(Fiber.joinAll(fibers), Queue.end(out)));
        yield* Deferred.succeed(entry.ready, { captured, scope: yield* Effect.scope, cut: Effect.asVoid(Queue.end(out)) });
        yield* Queue.offer(out, { kind: 'state', state: 'live' });
        yield* captures.open(
          {
            kind: RECOGNITION,
            noun: { one: 'recognition', many: 'recognitions' },
            id: ask.id,
            projectId: null,
            sources: tracks.map((track) => track.source),
            at: ask.tracks.some((track) => track.at === 'caller') ? 'caller' : 'server',
            startedAt: new Date(clock.currentTimeMillisUnsafe()).toISOString(),
          },
          finish(ask.id),
        );
        return Stream.fromQueue(out);
      }),
    );

  const finish = Effect.fn('Listenings.finish')(function* (id: string): Effect.fn.Return<void, GateRefusal<'unknown-recognition'>> {
    const entry = open.get(id);
    if (entry === undefined) return yield* unknownRecognition(id);
    const registered = yield* Deferred.await(entry.ready);
    if (registered === undefined) return yield* unknownRecognition(id);
    yield* Effect.forEach(registered.captured, (one) => one.capture.end, { discard: true });
    if (entry.finishing) return;
    entry.finishing = true;
    yield* Effect.forkIn(Effect.andThen(Effect.sleep(SLOWEST_TAIL_MS), registered.cut), registered.scope);
  });
  return Recognitions.of({ recognize, finish, send: senders.send });
});
