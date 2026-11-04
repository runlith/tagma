import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { join } from 'node:path';
import { currentPlatform } from '@runlith/chrome-for-testing/launch';
import { LaunchPlatform } from '../src/managed-browser/contract/service/launch.ts';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { makeChromeForTesting } from '../src/managed-browser/builds/chromeForTesting.ts';
import { ManagedPlace } from '../src/managed-browser/contract/service/place.ts';
import { TEST_BUILDS } from '../src/managed-browser/testing/cache.ts';
import { makeBackground } from '../src/platform/background.ts';
import { Background } from '../src/platform/contract/service/background.ts';

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const program = Effect.gen(function* () {
  const build = yield* makeChromeForTesting;
  console.log((yield* build.launch).executable);
});

await Effect.runPromise(
  program.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        host,
        Layer.sync(LaunchPlatform, currentPlatform),
        FetchHttpClient.layer,
        BunChildProcessSpawner.layer.pipe(Layer.provide(host)),
        Layer.effect(Background, makeBackground),
        Layer.succeed(ManagedPlace, { builds: TEST_BUILDS, profiles: join(TEST_BUILDS, 'unused'), downloads: join(TEST_BUILDS, 'unused') }),
      ),
    ),
  ),
);
