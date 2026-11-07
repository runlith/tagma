import type { Format } from '@runlith/audio/sound/format';
import { Effect, Exit, Fiber, Layer, PubSub, type Scope, Stream } from 'effect';
import { HttpClient } from 'effect/http';
import type { SpeechPart } from '../engine/catalog.ts';
import type { RecognitionChoice } from '../engine/choose.ts';
import type { RecognitionOptions, SpeechSet } from '../engine/set.ts';
import { Speech } from '../engine/Speech.ts';
import { SpeechCredentials } from '../engine/SpeechCredentials.ts';
import { SpeechDetector } from '../engine/SpeechDetector.ts';
import { SpeechSources, type SpeechStanding } from '../engine/SpeechSources.ts';
import type { AnyProvider, SpeechHost } from '../protocol/adapter.ts';
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
  readonly service: Speech['Service'];
  readonly speech: SpeechSet;
  readonly reload: (parts: ReadonlyArray<SpeechPart<SpeechHost>>, taken?: ReadonlyMap<string, string>) => Effect.Effect<SpeechSet>;
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
  providers: ReadonlyArray<AnyProvider<SpeechHost>>,
  body: (world: World) => Effect.Effect<A, E, Scope.Scope>,
  detector: Layer.Layer<SpeechDetector> = fakeDetector(),
  keys: Layer.Layer<SpeechCredentials> = credentials,
): Effect.fn.Return<A, E, Scope.Scope> {
  const transport = yield* scriptedTransport;
  const standings = yield* PubSub.sliding<SpeechStanding>({ capacity: 1, replay: 1 });
  let standing: SpeechStanding = { parts: [{ owner: 'world', providers }], taken: new Map() };
  const sources = Layer.succeed(SpeechSources, { current: () => standing, changes: Stream.fromPubSub(standings) });
  const layer = Speech.layer.pipe(
    Layer.provide(Layer.mergeAll(sources, transport.layer, keys, detector, Layer.succeed(HttpClient.HttpClient, offline))),
  );
  return yield* Effect.gen(function* () {
    const service = yield* Speech;
    const speech = yield* service.now;
    const world: World = {
      transport,
      service,
      speech,
      reload: Effect.fnUntraced(function* (next, taken = new Map()) {
        const before = yield* service.now;
        standing = { parts: next, taken };
        yield* PubSub.publish(standings, standing);
        const after = yield* Stream.runHead(Stream.filter(service.changes, (set) => set !== before));
        return yield* Effect.fromOption(after).pipe(Effect.orDie);
      }),
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
