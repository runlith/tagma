import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeChromiumSources } from '@runlith/browser-cookies/chromium';
import { makeFirefoxSource } from '@runlith/browser-cookies/firefox';
import { makeSafariSource } from '@runlith/browser-cookies/safari';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { MODULES } from '@tagma/server/composition/modules';
import { Deferred, Effect, Layer, type Scope } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { CookieSources } from '../browser/contract/service/cookies.js';
import { HOST_ADAPTERS, HostAdapters } from '../browser/contract/service/hosts.js';
import { BrowserPlace } from '../browser/contract/service/place.js';
import { ThreadRuns } from '../browser/contract/service/runs.js';
import { ManagedPlace } from '../managed-browser/contract/service/place.js';
import type { ThreadRunning } from '../threads/contract/service/reads.js';

export const browserRuns = (): {
  readonly port: ThreadRuns['Service'];
  readonly bind: (running: ThreadRunning['Service']) => Effect.Effect<void, never, Scope.Scope>;
} => {
  let current = Deferred.makeUnsafe<ThreadRunning['Service']>();
  return {
    port: {
      running: (thread) =>
        Deferred.isDoneUnsafe(current)
          ? Effect.flatMap(Deferred.await(current), (owner) =>
              owner.runningRunOf(thread).pipe(
                Effect.map((run) => run !== null),
                Effect.catchTags({
                  SqlError: (failure) =>
                    Effect.as(Effect.logWarning(`browser: whether thread ${thread} runs was not read: ${failure.message}`), true),
                  EffectDrizzleQueryError: (failure) =>
                    Effect.as(Effect.logWarning(`browser: whether thread ${thread} runs was not read: ${failure.message}`), true),
                }),
              ),
            )
          : Effect.succeed(false),
    },
    bind: (running) =>
      Effect.acquireRelease(Effect.asVoid(Deferred.succeed(current, running)), () =>
        Effect.sync(() => {
          current = Deferred.makeUnsafe<ThreadRunning['Service']>();
        }),
      ),
  };
};

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

export const cookieSourcesLayer = Layer.effect(
  CookieSources,
  Effect.gen(function* () {
    if (process.platform !== 'darwin') return CookieSources.of({ all: [] });
    const home = homedir();
    const chromium = yield* makeChromiumSources({ home });
    const firefox = yield* makeFirefoxSource({ home });
    const safari = yield* makeSafariSource({ home });
    return CookieSources.of({ all: [...chromium, firefox, safari] });
  }),
).pipe(Layer.provide(host));

export const browserBindings = (input: { readonly data: string; readonly runs: ThreadRuns['Service'] }) => {
  const root = join(input.data, 'browser');
  return Layer.mergeAll(
    Layer.succeed(BrowserPlace, { root }),
    Layer.succeed(ManagedPlace, { profiles: join(root, 'profiles'), builds: join(root, 'builds'), downloads: join(root, 'downloads') }),
    Layer.succeed(HostAdapters, { all: HOST_ADAPTERS.collect(MODULES).map(({ entry }) => entry) }),
    Layer.succeed(ThreadRuns, input.runs),
    BunChildProcessSpawner.layer.pipe(Layer.provide(host)),
    FetchHttpClient.layer,
    host,
  );
};
