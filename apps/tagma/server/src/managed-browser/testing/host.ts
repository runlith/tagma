import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { join } from 'node:path';
import { kind, world } from '@runlith/testbed/worlds';
import { Context, Effect, Exit, Layer } from 'effect';
import { HttpClient, HttpClientError } from 'effect/http';
import { ChildProcessSpawner } from 'effect/process';
import { currentPlatform } from '@runlith/chrome-for-testing/launch';
import { LaunchPlatform } from '../contract/service/launch.js';
import { type Host, Hosts } from '../../browser/contract/service/hosts.js';
import { ProfileId } from '../../browser/contract/wire/ids.js';
import { absentAdapter, browserWorld, type BrowserFixture } from '../../browser/testing/world.js';
import { managedAdapter } from '../adapter.js';
import { makeInstalledChrome } from '../builds/installedChrome.js';
import { makeBackground } from '../../platform/background.js';
import { Background } from '../../platform/contract/service/background.js';
import { ManagedPlace } from '../contract/service/place.js';
import { makeManagedHost } from '../host.js';
import { FILL_CACHE, TEST_BUILDS } from './cache.js';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

export const offline = (builds: string) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            description: `this test downloads nothing; fill ${builds} with \`${FILL_CACHE}\``,
          }),
        }),
      ),
    ),
  );

export const chromeInstalled: boolean = Exit.isSuccess(
  await Effect.runPromise(
    Effect.exit(Effect.flatMap(makeInstalledChrome, (build) => build.launch)).pipe(
      Effect.provide(Layer.provideMerge(BunChildProcessSpawner.layer, platform)),
      Effect.provide(Layer.sync(LaunchPlatform, currentPlatform)),
    ),
  ),
);

export const INSTALLED = ProfileId.make('installed-agent');
export const SHOWN = ProfileId.make('shown-agent');
export const OTHER = ProfileId.make('managed-other');
export const testAdapter = {
  ...managedAdapter,
  seeds: [
    ...managedAdapter.seeds,
    { id: INSTALLED, name: 'Agent (installed Chrome)', document: { build: 'installed-chrome' }, input: 'fast' as const },
    {
      id: SHOWN,
      name: 'Agent (installed Chrome, windowed)',
      document: { build: 'installed-chrome', window: 'shown' },
      input: 'fast' as const,
    },
    { id: OTHER, name: 'Other', document: { build: 'chrome-for-testing' }, input: 'fast' as const },
  ],
};

class ManagedBrowser extends Context.Service<ManagedBrowser, BrowserFixture>()('testing/ManagedBrowser') {}

type BrowserParams = { readonly native?: true; readonly missing?: true };

const managedWorld = kind(ManagedBrowser, (_params: null, home) =>
  Layer.build(browserWorld({ home, adapters: [testAdapter, absentAdapter(testAdapter)], host: Layer.empty })).pipe(
    Effect.map((services) => ({ home, services })),
    Effect.orDie,
  ),
);

export const managedFixture = (params: BrowserParams = {}, wrap?: TestHost['wrap']) =>
  Layer.unwrap(
    Effect.map(ManagedBrowser, ({ home, services }) =>
      managedTestHost(home, { native: params.native, builds: params.missing ? join(home, 'builds') : undefined, wrap }).pipe(
        Layer.provideMerge(Layer.succeedContext(services)),
      ),
    ),
  ).pipe(Layer.provide(world(managedWorld, null)));

export type TestHost = {
  readonly builds?: string;
  readonly native?: true;
  readonly wrap?: (host: Host) => Host;
  readonly spawner?: ChildProcessSpawner.ChildProcessSpawner['Service'];
};

export const managedTestHost = (home: string, options: TestHost = {}) => {
  const builds = options.builds ?? TEST_BUILDS;
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const hosts = yield* Hosts;
      const made = yield* makeManagedHost;
      const host = options.wrap === undefined ? made : options.wrap(made);
      yield* hosts.attach(options.native === true ? { ...host, native: true } : host);
    }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ManagedPlace, { builds, profiles: join(home, 'profiles'), downloads: join(home, 'downloads') }),
        Layer.sync(LaunchPlatform, currentPlatform),
        Layer.effect(Background, makeBackground),
        offline(builds),
        (options.spawner === undefined
          ? BunChildProcessSpawner.layer
          : Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, options.spawner)
        ).pipe(Layer.provide(platform)),
        platform,
      ),
    ),
  );
};
