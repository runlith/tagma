import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunSocketServer from '@effect/platform-bun/BunSocketServer';
import { helperClientLayer } from '@runlith/audio/helper/client';
import { AudioDevices } from '@runlith/audio/port/devices';
import { capabilities } from '@runlith/audio-darwin/capabilities';
import { DarwinChannel, LocalSockets } from '@runlith/audio-darwin/channel';
import { Speech } from '@runlith/speech/engine/Speech';
import { SpeechDetector } from '@runlith/speech/engine/SpeechDetector';
import { webSocketTransport } from '@runlith/speech/transport/websocket';
import { openai } from '@runlith/speech-openai/provider';
import { soniox } from '@runlith/speech-soniox/provider';
import { detectorLayer } from '@runlith/speech-whisper/detector';
import { Engine } from '@runlith/speech-whisper/Engine';
import { ModelStore } from '@runlith/speech-whisper/ModelStore';
import { unbuiltProvider, whisperProvider } from '@runlith/speech-whisper/provider';
import { Effect, Layer, Stream } from 'effect';
import { FetchHttpClient } from 'effect/http';
import {
  AUDIO_HELPER,
  CURRENT,
  SILERO_PART,
  SPEECH_MODELS,
  WHISPER_ABSENCE_PART,
  WHISPER_ENGINE_PART,
} from '../installation/contract/wire/layout.js';
import { type Installation, releaseApplication } from '../installation/contract/wire/manifest.js';
import { installationRoot } from '../installation/paths.js';
import type { Channel } from '../installation/contract/wire/channel.js';
import { Echo, EchoUnloaded } from '../speech/contract/service/echo.js';
import { CallThreads } from '../speech/contract/service/callThreads.js';
import { RecordingsPlace } from '../speech/contract/service/recording.js';
import { speech } from '../speech/speech.js';
import { InstallFailed, LocalModels, ModelRefused } from '../speech/contract/service/models.js';

export const CLOUD_SPEECH = [soniox, openai] as const;

export const KEYED_SPEECH: ReadonlyArray<string> = CLOUD_SPEECH.filter((provider) => provider.credential._tag === 'required').map(
  (provider) => provider.id,
);

export type SpeechPlace = {
  readonly hostApp: string;
  readonly engine: string;
  readonly silero: string;
  readonly absence: string;
  readonly models: string;
  readonly data: string;
};

export const speechPlace = (channel: Channel, sourcePath: string, installation: Installation | undefined, data: string): SpeechPlace => {
  const tools = installation === undefined ? resolve(sourcePath, '..', '..', '..', 'packages', 'speech-whisper', 'bin') : undefined;
  return {
    hostApp: releaseApplication(installation?.root ?? join(installationRoot(channel), CURRENT), channel.name),
    engine: tools === undefined ? join(installation!.root, WHISPER_ENGINE_PART) : join(tools, 'whisper-engine'),
    silero: tools === undefined ? join(installation!.root, SILERO_PART) : join(tools, 'silero.bin'),
    absence: tools === undefined ? join(installation!.root, WHISPER_ABSENCE_PART) : join(tools, 'whisper-engine.absent'),
    models: join(data, SPEECH_MODELS),
    data,
  };
};

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const spawner = BunChildProcessSpawner.layer.pipe(Layer.provide(host));

export const webSockets = webSocketTransport((url, protocols, headers) => new WebSocket(url, { headers, protocols }));

const sockets = Layer.succeed(LocalSockets, { listen: (path) => BunSocketServer.make({ path }) });

const standing = (path: string): Effect.Effect<string> => Effect.sync(() => (existsSync(path) ? realpathSync(path) : path));

const devices = (place: SpeechPlace): Layer.Layer<AudioDevices> =>
  process.platform === 'darwin'
    ? helperClientLayer(capabilities(release())).pipe(
        Layer.provide(DarwinChannel.layer(standing(place.hostApp), AUDIO_HELPER, place.data, tmpdir())),
        Layer.provide(Layer.mergeAll(sockets, spawner, host)),
      )
    : AudioDevices.none(`Tagma captures and plays sound on macOS; this machine runs ${process.platform}`);

const store = (place: SpeechPlace) => ModelStore.layer(place.models).pipe(Layer.provide(Layer.mergeAll(host, FetchHttpClient.layer)));

const local = Layer.effect(
  LocalModels,
  Effect.map(ModelStore, (models) =>
    LocalModels.of({
      list: Effect.map(
        Effect.mapError(models.list, (failure) => new ModelRefused({ code: 'models-unreadable', message: failure.message })),
        (states) =>
          states.map((state) => ({
            id: state.artifact.id,
            label: state.artifact.label,
            size: state.artifact.size,
            installed: state.installed,
            partial: state.partial,
          })),
      ),
      install: (model) =>
        Stream.mapError(models.install(model), (failure) => {
          switch (failure._tag) {
            case 'ModelUnknown':
              return new ModelRefused({ code: 'unknown-model', message: failure.message });
            case 'StoreFailed':
              return new ModelRefused({ code: 'models-unreadable', message: failure.message });
            default:
              return new InstallFailed({ model, message: failure.message });
          }
        }),
      remove: (model) =>
        models.remove(model).pipe(
          Effect.catchTag('InstallBusy', (busy) => Effect.die(busy)),
          Effect.mapError(
            (failure) =>
              new ModelRefused({ code: failure._tag === 'ModelUnknown' ? 'unknown-model' : 'models-unreadable', message: failure.message }),
          ),
        ),
    }),
  ),
);

const recognizers = (place: SpeechPlace) => {
  if (!existsSync(place.engine) || !existsSync(place.silero)) {
    const recorded = existsSync(place.absence) ? readFileSync(place.absence, 'utf8').trim() : '';
    const reason = recorded !== '' ? recorded : `the Whisper engine is not built at ${place.engine}`;
    return Speech.layer([...CLOUD_SPEECH, unbuiltProvider(reason)]).pipe(
      Layer.provideMerge(SpeechDetector.none(reason, ['build it with bun run --cwd packages/speech-whisper build'])),
    );
  }
  const engine = Engine.layer({ engine: place.engine, silero: place.silero }).pipe(Layer.provide(spawner));
  return Layer.unwrap(Effect.map(whisperProvider, (whisper) => Speech.layer([...CLOUD_SPEECH, whisper]))).pipe(
    Layer.provideMerge(detectorLayer),
    Layer.provide(engine),
  );
};

const echo = Layer.succeed(Echo, {
  open: (format) =>
    Effect.tryPromise({
      try: () => import('@runlith/echo/sonora'),
      catch: (cause) => new EchoUnloaded({ message: `the echo canceller did not load: ${String(cause)}` }),
    }).pipe(Effect.flatMap((sonora) => sonora.open(format))),
});

const speechBindings = (place: SpeechPlace) =>
  Layer.mergeAll(recognizers(place), devices(place), local, echo).pipe(
    Layer.provide(store(place)),
    Layer.provide(Layer.mergeAll(webSockets, FetchHttpClient.layer)),
  );

export const speechInstallation = <A, E, R>(input: {
  readonly place: SpeechPlace;
  readonly credentials: Layer.Layer<A, E, R>;
  readonly calls: CallThreads['Service'];
  readonly recordings: string;
}) =>
  speech.lifetimes.installation.pipe(
    Layer.provideMerge(speechBindings(input.place).pipe(Layer.provide(input.credentials))),
    Layer.provide(Layer.succeed(CallThreads, input.calls)),
    Layer.provide(Layer.succeed(RecordingsPlace, { root: input.recordings })),
  );
