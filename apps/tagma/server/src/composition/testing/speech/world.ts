import { chunk } from '@runlith/audio/sound/chunk';
import { captureFormat } from '@runlith/audio/sound/format';
import { type Gap, gap } from '@runlith/audio/sound/gap';
import { type FakeDevices, makeFakeDevices } from '@runlith/audio/testing/devices';
import { AudioDevices, type OutputKind } from '@runlith/audio/port/devices';
import type { EndReason } from '@runlith/audio/sound/track';
import type { SpeechProvider } from '@runlith/speech/protocol/adapter';
import type { DuplexTransport } from '@runlith/speech/protocol/transport';
import { Speech } from '@runlith/speech/engine/Speech';
import { SpeechSources } from '@runlith/speech/engine/SpeechSources';
import { fakeDetector } from '@runlith/speech/testing/fakeDetector';
import { streaming, voiced } from '@runlith/speech/testing/models';
import { type Key, scriptedProvider } from '@runlith/speech/testing/scriptedProvider';
import { type ScriptedLink, scriptedTransport } from '@runlith/speech/testing/ScriptedTransport';
import { credentials, offline } from '@runlith/speech/testing/world';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { type Cause, Clock, Context, Deferred, Effect, Exit, FileSystem, Layer, Queue, Scope, Stream } from 'effect';
import { HttpClient } from 'effect/http';
import { Settings } from '../../../settings/contract/service/values.js';
import { Captures } from '../../../speech/contract/service/captures.js';
import { Recognitions } from '../../../speech/contract/service/recognitions.js';
import { LocalModels, Models } from '../../../speech/contract/service/models.js';
import { Speaking } from '../../../speech/contract/service/speaking.js';
import { speechLayer, type SpeechServices } from '../../../speech/layer.js';
import { statusOf } from '../../../speech/status.js';

export const silence = new Int16Array(320);
export const voice = new Int16Array(320).fill(2_000);

export const fallbacks: Settings['Service'] = {
  read: () => Effect.die('read'),
  value: (key) => Effect.succeed(key.fallback),
  chain: () => Effect.die('chain'),
  live: () => Effect.die('live'),
  held: () => Effect.die('held'),
  changes: () => Effect.die('changes'),
  write: () => Effect.die('write'),
  amend: () => Effect.die('amend'),
};

const noModels: LocalModels['Service'] = { list: Effect.succeed([]), install: () => Stream.empty, remove: () => Effect.void };

const scripted = scriptedProvider({ id: 'scripted', recognition: [streaming('live')], synthesis: [voiced('voice', 'stream')] });

export const separating = scriptedProvider({ id: 'scripted', recognition: [streaming('live', { speakers: true })] });

export type World = {
  readonly recognitions: Recognitions['Service'];
  readonly captures: Captures['Service'];
  readonly speaking: Speaking['Service'];
  readonly models: Models['Service'];
  readonly status: ReturnType<typeof statusOf>;
  readonly devices: FakeDevices;
  readonly links: Effect.Effect<ScriptedLink>;
  readonly play: (capture: number, chunks: number) => Effect.Effect<void>;
  readonly sound: (capture: number, at: bigint, pcm: Int16Array) => Effect.Effect<void>;
  readonly pulled: (capture: number) => Effect.Effect<void>;
  readonly overflow: (capture: number, from: bigint, to: bigint) => Effect.Effect<void>;
  readonly drain: (capture: number) => Effect.Effect<void>;
  readonly now: () => bigint;
  readonly skip: (capture: number, ms: number) => Effect.Effect<void>;
  readonly close: (handing: boolean) => Effect.Effect<void>;
};

export type Opening = {
  readonly settings?: Settings['Service'];
  readonly local?: LocalModels['Service'];
  readonly provider?: SpeechProvider<Key, DuplexTransport>;
  readonly output?: OutputKind;
  readonly ending?: EndReason;
};

export type Heard = {
  readonly world: World;
  readonly built: Context.Context<SpeechServices | Speech | AudioDevices | Settings>;
};

export const awaited = Effect.fnUntraced(function* <A, E, R>(read: Effect.Effect<A, E, R>, check: (value: A) => boolean, _what: string) {
  for (;;) {
    const value = yield* read;
    if (check(value)) return value;
    yield* Effect.sleep(10);
  }
});

export const until = (check: () => boolean, what: string): Effect.Effect<void> =>
  Effect.asVoid(awaited(Effect.sync(check), (ready) => ready, what));

export const sentFinish = (link: ScriptedLink) => () =>
  link.sent.some((message) => typeof message === 'string' && message.includes('"type":"finish"'));

export const codeOf = (failure: { readonly _tag: string; readonly code?: string }): string => failure.code ?? failure._tag;

export const heardIn = Effect.fnUntraced(function* (opening: Opening, scope: Scope.Closeable, closing: (handing: boolean) => void) {
  const settings = opening.settings ?? fallbacks;
  const transport = yield* scriptedTransport;
  const queues = yield* Effect.forEach([0, 1, 2], () => Queue.unbounded<ReturnType<typeof chunk> | Gap, Cause.Done>());
  const pulled = yield* Effect.forEach(queues, () => Deferred.make<void>());
  const devices = makeFakeDevices({
    output: opening.output,
    capture: (_request, index) => ({
      sounds: Stream.fromQueue(queues[index]!).pipe(Stream.tap(() => Deferred.succeed(pulled[index]!, undefined))),
      ending: opening.ending,
    }),
  });
  const clock = yield* Clock.Clock;
  const at = [0n, 0n, 0n];
  const heard = yield* Layer.buildWithScope(
    Speech.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(SpeechSources, { parts: Stream.succeed([{ owner: 'world', providers: [opening.provider ?? scripted] }]) }),
          transport.layer,
          credentials,
          fakeDetector(),
          Layer.succeed(HttpClient.HttpClient, offline),
        ),
      ),
    ),
    scope,
  );
  const audio = yield* Layer.buildWithScope(devices.layer, scope);
  const deps = Layer.mergeAll(
    Layer.succeedContext(heard),
    Layer.succeedContext(audio),
    Layer.succeed(LocalModels, opening.local ?? noModels),
    Layer.succeed(Settings, settings),
    Layer.succeed(FileSystem.FileSystem, yield* FileSystem.FileSystem),
  );
  const spoken = yield* Layer.buildWithScope(speechLayer.pipe(Layer.provide(deps)), scope);
  const next = (capture: number): bigint => {
    const now = at[capture] === 0n ? clock.monotonicTimeNanosUnsafe() : at[capture]!;
    at[capture] = now + 20_000_000n;
    return now;
  };
  const world: World = {
    recognitions: Context.get(spoken, Recognitions),
    captures: Context.get(spoken, Captures),
    speaking: Context.get(spoken, Speaking),
    models: Context.get(spoken, Models),
    status: Effect.flatMap(Context.get(heard, Speech).now, (set) =>
      statusOf(set, Context.get(audio, AudioDevices), Context.get(spoken, Models), settings, 'server'),
    ),
    devices,
    links: transport.next,
    play: (capture, chunks) =>
      Effect.forEach(
        Array.from({ length: chunks }),
        (_, index) => Queue.offer(queues[capture]!, chunk(captureFormat, next(capture), index === 0 ? silence : voice)),
        { discard: true },
      ),
    sound: (capture, moment, pcm) => Effect.asVoid(Queue.offer(queues[capture]!, chunk(captureFormat, moment, pcm))),
    pulled: (capture) => Deferred.await(pulled[capture]!),
    overflow: (capture, from, to) => Effect.asVoid(Queue.offer(queues[capture]!, gap(from, to, 'overflow'))),
    drain: (capture) => Effect.asVoid(Queue.end(queues[capture]!)),
    now: () => clock.monotonicTimeNanosUnsafe(),
    skip: (capture, ms) =>
      Effect.asVoid(
        Effect.suspend(() => {
          const from = next(capture);
          at[capture] = from + BigInt(ms) * 1_000_000n;
          return Queue.offer(queues[capture]!, gap(from, at[capture], 'device-change'));
        }),
      ),
    close: (handing) =>
      Effect.suspend(() => {
        closing(handing);
        return Scope.close(scope, Exit.void);
      }),
  };
  const built: Heard['built'] = Context.merge(Context.merge(heard, audio), spoken).pipe(Context.add(Settings, settings));
  return { world, built } satisfies Heard;
});

const makeStand = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const openedWith = Effect.fnUntraced(function* (opening: Opening = {}) {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const { world } = yield* heardIn(opening, scope, () => undefined).pipe(Effect.provideService(FileSystem.FileSystem, files));
    return world;
  });
  return { opened: openedWith(), openedWith };
});

export class SpeechFixture extends Context.Service<SpeechFixture, { readonly stand: Effect.Success<typeof makeStand> }>()(
  'testing/SpeechFixture',
) {}

export const speechFixture = () =>
  Layer.effect(
    SpeechFixture,
    Effect.map(makeStand, (stand) => ({ stand })),
  ).pipe(Layer.provideMerge(BunFileSystem.layer));
