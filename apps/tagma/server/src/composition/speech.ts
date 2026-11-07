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
import type { AnyProvider, SpeechHost, SpeechProvider } from '@runlith/speech/protocol/adapter';
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
  SILERO_PART,
  SPEECH_MODELS,
  WHISPER_ABSENCE_PART,
  WHISPER_ENGINE_PART,
} from '../installation/contract/wire/layout.js';
import { CURRENT } from '../platform/contract/wire/versions.js';
import type { Installation } from '../installation/contract/wire/manifest.js';
import { applications } from '../mac-applications/placement.js';
import { installationRoot } from '../installation/paths.js';
import type { Channel } from '../installation/contract/wire/channel.js';
import { speech } from '../speech/speech.js';
import { InstallFailed, LocalModels, ModelRefused } from '../speech/contract/service/models.js';
import type { BuiltinSpeechId } from './builtinSpeech.js';
import type { PluginRevisions, ProviderParts } from '../plugins/contract/service/plugins.js';
import type { KeyedProviders } from '../providers/contract/service/credentials.js';
import {
  type BuiltinSpeech,
  type SpeechKeys,
  type SpeechParts,
  speechHolding,
  speechPartsWith,
  speechSourcesWith,
} from './speechSources.js';

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
    hostApp: applications.kept(installation?.root ?? join(installationRoot(channel), CURRENT), channel.name),
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

const localModels = Layer.effect(
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

type Local = { readonly built: true; readonly engine: Layer.Layer<Engine> } | { readonly built: false; readonly reason: string };

const localOf = (place: SpeechPlace): Local => {
  if (existsSync(place.engine) && existsSync(place.silero))
    return { built: true, engine: Engine.layer({ engine: place.engine, silero: place.silero }).pipe(Layer.provide(spawner)) };
  const recorded = existsSync(place.absence) ? readFileSync(place.absence, 'utf8').trim() : '';
  return { built: false, reason: recorded !== '' ? recorded : `the Whisper engine is not built at ${place.engine}` };
};

const WHISPER = 'whisper' satisfies BuiltinSpeechId;

const CLOUD: Readonly<Record<Exclude<BuiltinSpeechId, typeof WHISPER>, ReadonlyArray<AnyProvider<SpeechHost>>>> = {
  openai: [openai],
  soniox: [soniox],
};

const CLOUD_SPEECH: BuiltinSpeech = new Map(Object.entries(CLOUD));

const whisperOf = <R>(whisper: Effect.Effect<SpeechProvider<undefined>, never, R>): Effect.Effect<BuiltinSpeech, never, R> =>
  Effect.map(whisper, (provider): BuiltinSpeech => new Map([[WHISPER, [provider]]]));

const standingOf = (local: Local, models: Layer.Layer<ModelStore>) =>
  local.built
    ? speechSourcesWith(whisperOf(whisperProvider)).pipe(Layer.provide(local.engine), Layer.provide(models))
    : speechSourcesWith(whisperOf(Effect.succeed(unbuiltProvider(local.reason))));

const installationOf = <A, E, R>(
  place: SpeechPlace,
  local: Local,
  models: Layer.Layer<ModelStore>,
  parts: Layer.Layer<SpeechParts | SpeechKeys | KeyedProviders, never, ProviderParts | PluginRevisions>,
  credentials: Layer.Layer<A, E, R>,
) => {
  const detector = local.built
    ? detectorLayer.pipe(Layer.provide(local.engine))
    : SpeechDetector.none(local.reason, ['build it with bun run --cwd packages/speech-whisper build']);
  const recognizers = speechHolding.pipe(
    Layer.provideMerge(Speech.layer),
    Layer.provideMerge(detector),
    Layer.provide(standingOf(local, models)),
    Layer.provide(parts),
  );
  const bindings = Layer.mergeAll(recognizers, devices(place), localModels).pipe(
    Layer.provide(models),
    Layer.provide(Layer.mergeAll(webSockets, FetchHttpClient.layer)),
  );
  return speech.lifetimes.installation.pipe(Layer.provideMerge(bindings.pipe(Layer.provide(credentials))));
};

export const speechComposition = (place: SpeechPlace) => {
  const local = localOf(place);
  const models = store(place);
  const sources = speechPartsWith(CLOUD_SPEECH);
  return {
    sources,
    installation: <A, E, R>(credentials: Layer.Layer<A, E, R>) => installationOf(place, local, models, sources, credentials),
  };
};
