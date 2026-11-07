import { expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { chunk } from '@runlith/audio/sound/chunk';
import { ended, type Track } from '@runlith/audio/sound/track';
import { Speech } from '@runlith/speech/engine/Speech';
import { SpeechCredentials } from '@runlith/speech/engine/SpeechCredentials';
import { SpeechSources } from '@runlith/speech/engine/SpeechSources';
import { DuplexTransport } from '@runlith/speech/protocol/transport';
import { LIVE } from '@runlith/speech/wire/capabilities';
import { layer } from '@runlith/effect-test';
import { Clock, Effect, Layer, Stream } from 'effect';
import { HttpClient } from 'effect/http';
import { detectorLayer } from './detector.ts';
import { Engine } from './engine/Engine.ts';
import type { ModelArtifact } from './models/catalog.ts';
import { ModelStore } from './models/ModelStore.ts';
import { whisperProvider } from './provider.ts';

const bytes = new TextEncoder().encode('model');
const artifact: ModelArtifact = {
  id: 'tiny',
  label: 'Tiny',
  url: 'https://models.test/tiny.bin',
  size: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};

const whisper = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'speech-whisper-provider-'))),
      (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
    );
    const engine = join(root, 'engine');
    writeFileSync(engine, `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, 'testing', 'fakeEngine.ts')}"\n`);
    chmodSync(engine, 0o755);
    const installed = join(root, 'models', artifact.id);
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, 'model.bin'), bytes);
    const receipt = {
      model: artifact.id,
      url: artifact.url,
      size: artifact.size,
      sha256: artifact.sha256,
      installedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    };
    writeFileSync(join(installed, 'receipt.json'), JSON.stringify(receipt));

    const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
    const spawner = BunChildProcessSpawner.layer.pipe(Layer.provide(platform));
    const offline = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die('the store downloads nothing here')),
    );
    return Layer.mergeAll(
      Engine.layer({ engine, silero: join(root, 'silero.bin') }).pipe(Layer.provide(spawner)),
      ModelStore.layer(join(root, 'models'), [artifact]).pipe(Layer.provide(Layer.mergeAll(platform, offline))),
    );
  }),
);

const credentials = Layer.succeed(SpeechCredentials, { get: () => Effect.die('whisper takes no key') });

const sources = Layer.effect(
  SpeechSources,
  Effect.map(whisperProvider, (provider) => {
    const standing = { parts: [{ owner: 'whisper', providers: [provider] }], taken: new Map<string, string>() };
    return SpeechSources.of({ current: () => standing, changes: Stream.empty });
  }),
);

const unreached = Layer.mergeAll(
  Layer.succeed(DuplexTransport, { open: () => Effect.die('whisper opens no socket') }),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die('whisper reaches no server')),
  ),
);

const speech = Speech.layer.pipe(Layer.provide(Layer.mergeAll(sources, detectorLayer, credentials, unreached)), Layer.provide(whisper));

const format = { rate: 16_000, channels: 1 };

const finiteTrack = (ms: number): Track => {
  const pcm = new Int16Array(16 * ms).fill(3);
  return { format, chunks: Stream.make(chunk(format, 0n, pcm), ended('drained')), end: Effect.void };
};

layer(speech, { excludeTestServices: true })('local Whisper recognition', (it) => {
  it.effect('a finite track ends with Finished, its segments timed on the session scale', () =>
    Effect.gen(function* () {
      const speech = yield* (yield* Speech).now;
      const choice = yield* speech.recognizer({ kinds: LIVE, provider: 'whisper', model: artifact.id });
      const heard = yield* Stream.runCollect(speech.recognize(choice, finiteTrack(1_000), { track: 'mic', origin: 0n }));
      const closed = heard.filter((one) => one._tag === 'Utterance' && one.closed);
      expect(closed).toMatchObject([
        {
          text: 'clip 3',
          span: { from: 0, to: 1_000 },
          units: [{ lane: 'source', granularity: 'segment', language: 'en', time: { from: 0, to: 1_000 } }],
        },
      ]);
      expect(heard.at(-1)).toEqual({ _tag: 'Finished' });
    }),
  );

  it.effect('a hinted listening transcribes in the hinted language and its units carry it', () =>
    Effect.gen(function* () {
      const speech = yield* (yield* Speech).now;
      const choice = yield* speech.recognizer({ kinds: LIVE, provider: 'whisper', model: artifact.id, languages: ['de'] });
      const heard = yield* Stream.runCollect(speech.recognize(choice, finiteTrack(1_000), { track: 'mic', origin: 0n }));
      const units = heard.flatMap((one) => (one._tag === 'Utterance' && one.closed ? one.units : []));
      expect(units.map((unit) => unit.language)).toEqual(['de']);
    }),
  );
});
