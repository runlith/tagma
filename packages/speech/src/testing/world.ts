import type { Format } from '@runlith/audio/sound/format';
import { Effect, Exit, Fiber, Layer, type Scope, Stream } from 'effect';
import { HttpClient } from 'effect/http';
import type { AnyProvider } from '../engine/catalog.ts';
import type { RecognitionChoice } from '../engine/choose.ts';
import { type RecognitionOptions, Speech } from '../engine/Speech.ts';
import { SpeechCredentials } from '../engine/SpeechCredentials.ts';
import { SpeechDetector } from '../engine/SpeechDetector.ts';
import type { DuplexTransport } from '../protocol/transport.ts';
import type { SpeechEvent, Unit } from '../wire/events.ts';
import type { SpeechFailure } from '../wire/failure.ts';
import { incoming } from './scriptedProvider.ts';
import type { Heard } from '../wire/heard.ts';
import { fakeDetector } from './fakeDetector.ts';
import { type ScriptedTransport, scriptedTransport } from './ScriptedTransport.ts';
import { type ScriptedTrack, scriptedTrack } from './scriptedTrack.ts';

export type Listening = {
  readonly heard: Array<Heard>;
  readonly track: ScriptedTrack;
  readonly exit: () => Exit.Exit<void, SpeechFailure> | undefined;
  readonly stop: Effect.Effect<void>;
};

export type World = {
  readonly transport: ScriptedTransport;
  readonly speech: Speech['Service'];
  readonly listen: (
    choice: RecognitionChoice,
    options?: Partial<RecognitionOptions>,
    format?: Format,
  ) => Effect.Effect<Listening, never, Scope.Scope>;
};

export const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let turn = 0; turn < 40; turn++) yield* Effect.yieldNow;
});

export const play = (listening: Listening, values: ReadonlyArray<number>, frames = 320): Effect.Effect<void> =>
  Effect.forEach(values, (value) => Effect.andThen(listening.track.play(new Int16Array(frames).fill(value)), settle), {
    discard: true,
  });

export const word = (text: string, from: number, to: number, speaker?: string): Unit => ({
  lane: 'source',
  text,
  granularity: 'word',
  time: { from, to },
  speaker,
});

export const event = (item: SpeechEvent): string => incoming({ type: 'event', event: item });

export const ready = incoming({ type: 'ready' });

export const credentials = Layer.succeed(SpeechCredentials, {
  get: () => Effect.succeed({ apiKey: 'key' }),
});

export const offline = HttpClient.make((request) => Effect.die(new Error(`the scripted world reaches no server: ${request.url}`)));

export const inWorld = Effect.fnUntraced(function* <A, E>(
  providers: ReadonlyArray<AnyProvider<DuplexTransport | HttpClient.HttpClient>>,
  body: (world: World) => Effect.Effect<A, E, Scope.Scope>,
  detector: Layer.Layer<SpeechDetector> = fakeDetector(),
  keys: Layer.Layer<SpeechCredentials> = credentials,
): Effect.fn.Return<A, E, Scope.Scope> {
  const transport = yield* scriptedTransport;
  const layer = Speech.layer(providers).pipe(
    Layer.provide(Layer.mergeAll(transport.layer, keys, detector, Layer.succeed(HttpClient.HttpClient, offline))),
  );
  return yield* Effect.gen(function* () {
    const speech = yield* Speech;
    const world: World = {
      transport,
      speech,
      listen: Effect.fnUntraced(function* (
        choice: RecognitionChoice,
        options?: Partial<RecognitionOptions>,
        format: Format = { rate: 16_000, channels: 1 },
      ) {
        const track = yield* scriptedTrack(format);
        const heard: Array<Heard> = [];
        let exit: Exit.Exit<void, SpeechFailure> | undefined;
        const fiber = yield* Effect.forkScoped(
          Effect.onExit(
            Stream.runForEach(speech.recognize(choice, track.track, { track: 'mic', origin: 0n, ...options }), (item) =>
              Effect.sync(() => heard.push(item)),
            ),
            (done) =>
              Effect.sync(() => {
                exit = done;
              }),
          ),
        );
        return { heard, track, exit: () => exit, stop: Fiber.interrupt(fiber) };
      }),
    };
    return yield* body(world);
  }).pipe(Effect.provide(layer));
});
