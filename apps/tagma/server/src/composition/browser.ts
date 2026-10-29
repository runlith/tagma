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
import { runEnded, type ThreadRecords } from '../thread-record/contract/service/records.js';
import type { ThreadRunning } from '../threads/contract/service/reads.js';

type RunSources = { readonly running: ThreadRunning['Service']; readonly records: ThreadRecords['Service'] };

type Watched = { readonly kind: 'reading' } | { readonly kind: 'run'; readonly id: string } | { readonly kind: 'any' };

export const browserRuns = (): {
  readonly port: ThreadRuns['Service'];
  readonly bind: (sources: RunSources) => Effect.Effect<void, never, Scope.Scope>;
} => {
  let current = Deferred.makeUnsafe<RunSources>();
  const runOf = (owner: RunSources, thread: string) =>
    owner.running.runningRunOf(thread).pipe(
      Effect.catchTags({
        SqlError: (failure) =>
          Effect.as(Effect.logWarning(`browser: whether thread ${thread} runs was not read: ${failure.message}`), undefined),
        EffectDrizzleQueryError: (failure) =>
          Effect.as(Effect.logWarning(`browser: whether thread ${thread} runs was not read: ${failure.message}`), undefined),
      }),
    );
  return {
    port: {
      running: (thread) =>
        Deferred.isDoneUnsafe(current)
          ? Effect.flatMap(Deferred.await(current), (owner) => Effect.map(runOf(owner, thread), (run) => run !== null))
          : Effect.succeed(false),
      ending: Effect.fnUntraced(function* (thread) {
        if (!Deferred.isDoneUnsafe(current)) return Effect.void;
        const owner = yield* Deferred.await(current);
        const ended = yield* Deferred.make<void>();
        const before = new Set<string>();
        let watched: Watched = { kind: 'reading' };
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            owner.records.statusPublished((event) =>
              Effect.suspend(() => {
                if (event.threadId !== thread || !runEnded(event)) return Effect.void;
                if (watched.kind === 'reading') before.add(event.fromRunId!);
                else if (watched.kind === 'any' || watched.id === event.fromRunId) return Deferred.succeed(ended, undefined);
                return Effect.void;
              }),
            ),
          ),
          (detach) => Effect.sync(detach),
        );
        const run = yield* runOf(owner, thread);
        if (run === null) return Effect.void;
        watched = run === undefined ? { kind: 'any' } : { kind: 'run', id: run };
        if (run === undefined ? before.size > 0 : before.has(run)) return Effect.void;
        return Deferred.await(ended);
      }),
    },
    bind: (sources) =>
      Effect.acquireRelease(Effect.asVoid(Deferred.succeed(current, sources)), () =>
        Effect.sync(() => {
          current = Deferred.makeUnsafe<RunSources>();
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
