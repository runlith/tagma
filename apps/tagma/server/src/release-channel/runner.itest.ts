import { existsSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { kind, world } from '@runlith/testbed/worlds';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer, Option, Result, type Scope, Stream } from 'effect';
import { installRelease } from './install.js';
import { FetchHttpClient } from 'effect/http';
import { NextInstallation } from '../installation/contract/service/next.js';
import type { DowngradeSteps } from '../installation/contract/service/steps.js';
import type { NextFrame } from '../installation/contract/wire/next.js';
import type { InstallationPlatform } from '../installation/contract/wire/manifest.js';
import { releaseAt } from '../installation/closure/manifests.js';
import { clearStepBack, readReturn, readStepBack, writeAttempt, writeReturn } from '../installation/closure/attempt.js';
import { swapCurrent } from '../platform/lock/versionedDirectories.js';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import { Settings } from '../settings/contract/service/values.js';
import type { Feed } from '../installation/contract/wire/feed.js';
import { releasePlaces } from './places.js';
import { type ChannelPlace, makeReleaseChannel } from './runner.js';
import { releaseFeed } from './settings.js';
import { CHANNELS } from '../installation/contract/wire/channel.js';
import type { MachinePlatform } from '../installation/contract/service/platform.js';
import { carriedIn, packRelease, serverless, syntheticReleaseEffect, trustedApplications, type Packed } from './testing/release.js';
import { tarEntry, writeArchive } from './testing/tarball.js';

const setup = Effect.fnUntraced(function* (_params: {}, directory: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(directory, { recursive: true });
  const home = yield* files.realPath(directory);
  const root = join(home, '.tagma/install');
  const data = join(home, '.tagma');
  const places = releasePlaces(data);
  const executable = Bun.which('bun');
  if (executable === null) return yield* Effect.die('the release fixture needs a native bun on PATH');
  const native = { platform: { os: process.platform, arch: process.arch }, executable };
  const machine: MachinePlatform = { current: Effect.succeed(native.platform) };
  const platformKey = `${native.platform.os}-${native.platform.arch}`;

  let feed: Feed | null = null;
  let gate: PromiseWithResolvers<void> | null = null;
  const archives = new Map<string, string>();
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          if (path === '/feed.json') return feed === null ? new Response('missing', { status: 404 }) : Response.json(feed);
          const file = archives.get(path);
          if (file === undefined) return new Response('Not Found', { status: 404 });
          const held = gate;
          if (held === null) return new Response(Bun.file(file));
          const bytes = await Bun.file(file).bytes();
          return new Response(
            new ReadableStream({
              async start(sink) {
                sink.enqueue(bytes.slice(0, bytes.length >> 1));
                await held.promise;
                sink.enqueue(bytes.slice(bytes.length >> 1));
                sink.close();
              },
            }),
          );
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  );
  const url = `http://127.0.0.1:${server.port}`;
  const env = {
    ...process.env,
    HOME: home,
    TAGMA_INSTALL_ROOT: root,
    TAGMA_DATABASE_PATH: join(data, 'tagma.sqlite'),
  };
  let feedAt = `${url}/feed.json`;

  const settings = (): Settings['Service'] => {
    const unused = () => Effect.die('the release channel reads only its feed setting');
    return {
      read: unused,
      value: unused,
      chain: unused,
      live: unused,
      held: unused,
      changes: <A>(key: SettingKey<A>) => Effect.succeed(Stream.succeed((key.id === releaseFeed.id ? feedAt : key.fallback) as A)),
      write: unused,
      amend: unused,
    };
  };

  const restarts: string[] = [];
  const queue = { waiting: 0, closed: 0, reopened: 0 };
  const downgrade: DowngradeSteps['Service'] = {
    close: () => Effect.sync(() => void (queue.closed += 1)),
    reopen: () => Effect.sync(() => void (queue.reopened += 1)),
    drained: () => Effect.sync(() => ({ waiting: queue.waiting, unread: 0 })),
  };

  const servingFrom = (version: string | null) => {
    const manifest = version === null ? undefined : releaseAt(root, version);
    return manifest === undefined || version === null ? undefined : { root: join(root, version), manifest };
  };

  const placed = (
    running: string,
    serving: string | null,
    applications: ChannelPlace['applications'] = trustedApplications,
  ): ChannelPlace => ({
    installations: root,
    name: CHANNELS.stable.name,
    running,
    runsFrom: servingFrom(serving),
    places,
    applications,
    machine,
    downgrade,
    restart: Effect.sync(() => {
      restarts.push(running);
    }),
    env,
  });

  const channel = <A>(
    place: ChannelPlace,
    work: (next: NextInstallation['Service']) => Effect.Effect<A, unknown, Scope.Scope>,
    storage = files,
  ) =>
    Effect.scoped(Effect.flatMap(NextInstallation, work)).pipe(
      Effect.provide(
        Layer.effect(NextInstallation, makeReleaseChannel(place)).pipe(
          Layer.provide(
            Layer.mergeAll(Layer.succeed(Settings, settings()), FetchHttpClient.layer, Layer.succeed(FileSystem.FileSystem, storage)),
          ),
        ),
      ),
    );

  const until = (next: NextInstallation['Service'], seen: (frame: NextFrame) => boolean) =>
    next.changes.pipe(
      Stream.filter(seen),
      Stream.runHead,
      Effect.map((frame) => Option.getOrThrow(frame)),
    );

  const ended = (next: NextInstallation['Service'], since: string) => until(next, (frame) => frame.installed?.since === since);

  const releaseOf = (
    release: string,
    packed: Packed,
    irreversible: boolean,
    archive = `${url}/archive/${release}.tar.gz`,
    sha256 = packed.sha256,
  ) => ({
    release,
    platforms: { [platformKey]: { archive, sha256, size: packed.size } },
    irreversible,
    stores: { 'machine-store': [], 'host-store': [], graph: [], journal: [] },
    changes: irreversible ? [{ store: 'graph' as const, release }] : [],
  });

  const archived = (build: string, entries: readonly Buffer[]): Packed => {
    const packed = writeArchive(home, build, entries);
    archives.set(`/archive/${build}.tar.gz`, packed.file);
    return packed;
  };

  const packed = Effect.fnUntraced(function* (
    build: string,
    irreversible?: Parameters<typeof syntheticReleaseEffect>[2],
    platform: InstallationPlatform = native.platform,
  ) {
    const bundle = join(home, `unpacked-${build}`, 'Tagma.app');
    yield* syntheticReleaseEffect(bundle, build, irreversible, { ...native, platform });
    const pack = packRelease(bundle, join(home, `${build}.tar.gz`));
    archives.set(`/archive/${build}.tar.gz`, pack.file);
    return { ...pack, bundle };
  });

  yield* syntheticReleaseEffect(join(home, 'unpacked-0.1.0', 'Tagma.app'), '0.1.0', undefined, {
    ...native,
    platform: { os: process.platform, arch: process.arch },
    executable: process.execPath,
  });
  const carriedFirst = carriedIn(join(home, 'unpacked-0.1.0', 'Tagma.app'));
  const installedFirst = yield* installRelease(
    carriedFirst,
    { installRoot: root, launcher: join(data, 'bin/tagma'), name: CHANNELS.stable.name },
    trustedApplications,
    new Date(yield* Clock.currentTimeMillis),
    false,
    serverless,
  );
  if (installedFirst.status !== 'landed')
    return yield* Effect.die(
      `the initial release did not land: ${installedFirst.status === 'ask' ? installedFirst.said : installedFirst.detail}`,
    );
  const first = { version: readlinkSync(join(root, 'current')) };
  const second = yield* packed('0.2.0', [{ store: 'graph', release: '0.2.0' }]);
  const third = yield* packed('0.3.0');
  const fourth = yield* packed('0.4.0');

  const buildOf = (version: string | null) => (version === null ? null : (releaseAt(root, version)?.identity.build ?? null));
  const standing = () => readlinkSync(join(root, 'current'));
  const versionOf = (build: string) => readdirSync(root).find((one) => one !== 'current' && buildOf(one) === build) ?? null;
  return {
    home,
    root,
    places,
    url,
    platformKey,
    platform: native.platform,
    first,
    second,
    third,
    fourth,
    channel,
    placed,
    until,
    ended,
    releaseOf,
    packed,
    archived,
    buildOf,
    standing,
    versionOf,
    restarts,
    queue,
    get feed() {
      return feed;
    },
    set feed(value: Feed | null) {
      feed = value;
    },
    get gate() {
      return gate;
    },
    set gate(value: PromiseWithResolvers<void> | null) {
      gate = value;
    },
    get feedAt() {
      return feedAt;
    },
    set feedAt(value: string) {
      feedAt = value;
    },
  };
});
class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/ReleaseChannel') {}
const releaseWorld = kind(World, (params: {}, directory: string) => setup(params, directory).pipe(Effect.provide(BunFileSystem.layer)));
layer(world(releaseWorld, {}).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('release channel', (it) => {
  it.effect(
    'a release journey chooses the machine archive, installs, refuses unavailable and irreversible roads, cancels, prunes, steps back and accepts a local feed',
    () =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const world = yield* World;
          const { second, first, channel, placed, until, ended, url, restarts, buildOf, standing, places, releaseOf } = world;
          const offered = releaseOf('0.2.0', second, true);
          const other = `${world.platform.os}-${world.platform.arch === 'arm64' ? 'x64' : 'arm64'}`;
          world.feed = {
            releases: [
              {
                ...offered,
                platforms: {
                  ...offered.platforms,
                  [other]: { archive: `${url}/wrong-platform.tar.gz`, sha256: '0'.repeat(64), size: 2 },
                },
              },
              releaseOf('0.1.0', second, false),
            ],
          };
          const opened = Promise.withResolvers<void>();
          world.gate = opened;
          const half = second.size >> 1;
          const seen = yield* channel(placed('0.1.0', first.version), (next) =>
            Effect.gen(function* () {
              const offered = yield* until(next, (frame) => frame.offers.length > 0);
              const { installing } = yield* next.install('0.2.0', 'restart', null);
              const carried = yield* until(next, (frame) => frame.installing?.progress?.done === half);
              opened.resolve();
              return { offered, steps: installing.steps.map((step) => step.id), carried, ended: yield* ended(next, installing.since) };
            }),
          );
          world.gate = null;

          expect(seen.offered.update).toBe('0.2.0');
          expect(seen.offered.readFrom).toBe(`${url}/feed.json`);
          expect(seen.offered.offers[0]).toMatchObject({ id: '0.2.0', size: second.size });
          expect(seen.steps).toEqual(['download', 'verify', 'install', 'restart']);
          expect(seen.carried.installing).toMatchObject({ step: 'download', progress: { done: half, total: second.size } });
          expect(seen.ended.installed).toMatchObject({ outcome: 'landed', build: '0.2.0', restartRefused: null });
          expect(restarts).toEqual(['0.1.0']);
          expect(buildOf(standing())).toBe('0.2.0');
          expect(releaseAt(world.root, standing())?.platform).toEqual(world.platform);
          expect(existsSync(places.staging)).toBe(false);
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { second, channel, placed, standing, until, buildOf, releaseOf } = world;
          world.feed = { releases: [releaseOf('0.2.0', second, false), releaseOf('0.1.0', second, false)] };
          const seen = yield* channel(placed('0.2.0', standing()), (next) =>
            Effect.gen(function* () {
              const frame = yield* until(next, (one) => one.back !== null);
              const down = yield* Effect.result(next.install('0.1.0', 'restart', null));
              return { frame, down };
            }),
          );
          expect(seen.frame.back?.disabled).toBeNull();
          expect(seen.down._tag === 'Failure' ? seen.down.failure.code : 'started').toBe('no-offer');
          expect(buildOf(standing())).toBe('0.2.0');
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { fourth, third, standing, channel, placed, until, ended, url, places, releaseOf } = world;
          const before = standing();
          world.feed = {
            releases: [releaseOf('0.4.0', fourth, false, `${url}/archive/elsewhere.tar.gz`), releaseOf('0.3.0', third, false)],
          };
          const missing = yield* channel(placed('0.2.0', before), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.offers[0]?.id === '0.4.0');
              const unoffered = yield* Effect.result(next.install('0.3.0', null, null));
              const { installing } = yield* next.install('0.4.0', null, null);
              return { unoffered, end: yield* ended(next, installing.since) };
            }),
          );
          expect(missing.unoffered._tag === 'Failure' ? missing.unoffered.failure.code : 'started').toBe('no-offer');
          expect(missing.end.installed?.outcome).toBe('failed');
          expect(missing.end.installed?.detail).toContain('answered 404');
          expect(missing.end.issue).toBeNull();

          world.feed = { releases: [releaseOf('0.3.0', third, false, undefined, '0'.repeat(64))] };
          const tampered = yield* channel(placed('0.2.0', before), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.offers[0]?.id === '0.3.0');
              const { installing } = yield* next.install('0.3.0', null, null);
              return yield* ended(next, installing.since);
            }),
          );
          expect(tampered.installed?.outcome).toBe('failed');
          expect(tampered.installed?.detail).toContain('SHA-256');
          expect(standing()).toBe(before);
          expect(existsSync(places.staging)).toBe(false);
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { archived, standing, channel, placed, until, ended, places, releaseOf } = world;
          const before = standing();
          const conflicting = archived('0.2.1', [
            tarEntry('./Tagma.app/blocked', Buffer.from('a file')),
            tarEntry('./Tagma.app/blocked/payload', Buffer.from('cannot be written')),
          ]);
          world.feed = { releases: [releaseOf('0.2.1', conflicting, false)] };
          const refused = yield* channel(placed('0.2.0', before), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.offers[0]?.id === '0.2.1');
              const { installing } = yield* next.install('0.2.1', null, null);
              return yield* ended(next, installing.since);
            }),
          );
          expect(refused.installed?.outcome).toBe('failed');
          expect(refused.installed?.detail).toContain('blocked');
          expect(standing()).toBe(before);
          expect(existsSync(places.staging)).toBe(false);
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { third, standing, channel, placed, until, places, releaseOf } = world;
          const before = standing();
          const checking = yield* Deferred.make<void>();
          const applications: ChannelPlace['applications'] = {
            ...trustedApplications,
            signature: () => Deferred.succeed(checking, undefined).pipe(Effect.andThen(Effect.never)),
          };
          world.feed = { releases: [releaseOf('0.3.0', third, false)] };
          const stopped = yield* channel(placed('0.2.0', before, applications), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.offers[0]?.id === '0.3.0');
              yield* next.install('0.3.0', null, null);
              yield* Deferred.await(checking);
              expect(existsSync(join(carriedIn(join(places.staging, '0.3.0/Tagma.app')), 'install.json'))).toBe(true);
              return yield* next.stop();
            }),
          );
          expect(stopped?.outcome).toBe('stopped');
          expect(standing()).toBe(before);
          expect(existsSync(places.staging)).toBe(false);
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const files = yield* FileSystem.FileSystem;
          const { third, standing, channel, placed, until, places, releaseOf } = world;
          world.feed = { releases: [releaseOf('0.3.0', third, false)] };
          const opened = Promise.withResolvers<void>();
          world.gate = opened;
          let paused = false;
          let cleaning = yield* Deferred.make<void>();
          let resume = yield* Deferred.make<void>();
          const storage: FileSystem.FileSystem = {
            ...files,
            remove: Effect.fnUntraced(function* (path, options) {
              if (path === places.staging && paused) {
                paused = false;
                yield* Deferred.succeed(cleaning, undefined);
                yield* Deferred.await(resume);
              }
              yield* files.remove(path, options);
            }),
          };
          yield* channel(
            placed('0.2.0', standing()),
            (next) =>
              Effect.gen(function* () {
                yield* until(next, (frame) => frame.offers[0]?.id === '0.3.0');
                paused = true;
                const first = yield* Effect.forkScoped(next.install('0.3.0', null, null));
                yield* Deferred.await(cleaning);
                const concurrent = yield* Effect.forkScoped(Effect.result(next.install('0.3.0', null, null)));
                yield* Deferred.succeed(resume, undefined);
                const { installing } = yield* Fiber.join(first);
                const refused = yield* Fiber.join(concurrent);
                expect(refused._tag === 'Failure' ? refused.failure.code : 'started').toBe('install-running');
                yield* until(next, (frame) => (frame.installing?.progress?.done ?? 0) > 0);

                cleaning = yield* Deferred.make<void>();
                resume = yield* Deferred.make<void>();
                paused = true;
                const replacing = yield* Effect.forkScoped(next.install('0.3.0', null, installing.since));
                yield* Deferred.await(cleaning);
                expect((yield* next.installing)?.since).toBe(installing.since);
                yield* Deferred.succeed(resume, undefined);
                const replacement = yield* Fiber.join(replacing);
                expect(replacement.replaced).toMatchObject({ outcome: 'stopped', since: installing.since });
                yield* until(
                  next,
                  (frame) => frame.installing?.since === replacement.installing.since && (frame.installing.progress?.done ?? 0) > 0,
                );
                expect(existsSync(join(places.staging, '0.3.0.tar.gz.part'))).toBe(true);
                expect(yield* next.stop()).toMatchObject({ outcome: 'stopped', since: replacement.installing.since });
                expect(existsSync(places.staging)).toBe(false);
              }),
            storage,
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                opened.resolve();
                world.gate = null;
              }),
            ),
          );
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { third, fourth, standing, channel, placed, until, ended, places, buildOf, versionOf, releaseOf, root } = world;
          const serving = standing();
          world.feed = { releases: [releaseOf('0.3.0', third, false)] };
          const opened = Promise.withResolvers<void>();
          world.gate = opened;
          const stopped = yield* channel(placed('0.2.0', serving), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.offers[0]?.id === '0.3.0');
              yield* next.install('0.3.0', null, null);
              yield* until(next, (frame) => (frame.installing?.progress?.done ?? 0) > 0);
              const end = yield* next.stop();
              opened.resolve();
              return end;
            }),
          );
          world.gate = null;
          expect(stopped).toMatchObject({ outcome: 'stopped' });
          expect(existsSync(places.staging)).toBe(false);
          expect(standing()).toBe(serving);

          for (const [build, pack] of [
            ['0.3.0', third],
            ['0.4.0', fourth],
          ] as const) {
            world.feed = { releases: [releaseOf(build, pack, false)] };
            const landed = yield* channel(placed('0.2.0', serving), (next) =>
              Effect.gen(function* () {
                yield* until(next, (frame) => frame.offers[0]?.id === build);
                const { installing } = yield* next.install(build, null, null);
                return yield* ended(next, installing.since);
              }),
            );
            expect(landed.installed).toMatchObject({ outcome: 'landed', build });
          }
          expect(buildOf(standing())).toBe('0.4.0');
          expect(existsSync(join(root, serving))).toBe(true);
          expect([versionOf('0.1.0'), versionOf('0.3.0')]).toEqual([null, null]);
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { fourth, standing, queue, channel, placed, until, ended, buildOf, root, restarts, releaseOf } = world;
          world.feed = { releases: [releaseOf('0.4.0', fourth, false)] };
          const from = standing();
          queue.waiting = 2;
          const refused = yield* channel(placed('0.4.0', from), (next) =>
            Effect.gen(function* () {
              yield* until(next, (one) => one.back?.disabled === null);
              const { installing } = yield* next.install('back', null, null);
              return yield* ended(next, installing.since);
            }),
          );
          expect(refused.installed).toMatchObject({ outcome: 'failed' });
          expect(refused.installed?.detail).toContain('2 waiting');
          expect(queue).toMatchObject({ closed: 1, reopened: 1 });
          expect(standing()).toBe(from);

          queue.waiting = 0;
          const back = yield* channel(placed('0.4.0', from), (next) =>
            Effect.gen(function* () {
              yield* until(next, (one) => one.back?.disabled === null);
              const { installing } = yield* next.install('back', null, null);
              return yield* ended(next, installing.since);
            }),
          );
          expect(back.installed).toMatchObject({ outcome: 'landed', build: '0.2.0', then: 'restart' });
          expect(standing()).toBe(from);
          const asked = Result.getOrThrow(readStepBack(root));
          expect(asked).toMatchObject({ from, carried: false });
          expect(buildOf(asked!.to)).toBe('0.2.0');
          expect(queue).toMatchObject({ closed: 2, reopened: 1 });
          expect(restarts.at(-1)).toBe('0.4.0');
          clearStepBack(root);
          writeReturn(root, '0.4.0', asked!.to);
          swapCurrent(root, asked!.to);
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { packed, releaseOf, standing, channel, placed, until, home, url, places, ended, buildOf } = world;
          const fifth = yield* packed('0.5.0');
          const local = releaseOf('0.5.0', fifth, false, pathToFileURL(join(home, '0.5.0.tar.gz')).href);
          world.feed = { releases: [local] };
          const remote = yield* channel(placed('0.3.0', standing()), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.offers[0]?.id === '0.5.0');
              return yield* Effect.result(next.install('0.5.0', null, null));
            }),
          );
          expect(remote._tag === 'Failure' ? remote.failure.code : 'started').toBe('offer-unavailable');
          expect(existsSync(places.staging)).toBe(false);

          world.feed = { releases: [local] };
          writeFileSync(join(home, 'feed.json'), JSON.stringify({ releases: [local] }));
          world.feedAt = pathToFileURL(join(home, 'feed.json')).href;
          rmSync(places.record);
          const landed = yield* channel(placed('0.3.0', standing()), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.offers[0]?.id === '0.5.0');
              const { installing } = yield* next.install('0.5.0', null, null);
              return yield* ended(next, installing.since);
            }),
          );
          world.feedAt = `${url}/feed.json`;
          expect(landed.installed).toMatchObject({ outcome: 'landed', build: '0.5.0' });
          expect(buildOf(standing())).toBe('0.5.0');
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { fourth, releaseOf, standing, channel, placed, until } = world;
          const newest = releaseOf('0.7.0', fourth, false);
          world.feed = {
            releases: [{ ...newest, platforms: { foreign: Object.values(newest.platforms)[0]! } }, releaseOf('0.6.0', fourth, false)],
          };
          const denied = yield* channel(placed('0.5.0', standing()), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.issue?.code === 'platform-unavailable');
              return { reading: yield* next.reading, install: yield* Effect.result(next.install('0.7.0', null, null)) };
            }),
          );
          expect(denied.reading.offers).toEqual([]);
          expect(denied.reading.update).toBeNull();
          expect(denied.reading.issue?.code).toBe('platform-unavailable');
          expect(denied.reading.issue?.reason).toContain(world.platformKey);
          expect(denied.reading.issue?.unblock.length).toBeGreaterThan(0);
          expect(denied.install).toMatchObject({ _tag: 'Failure', failure: { code: 'platform-unavailable' } });

          world.feed = null;
          const absent = yield* channel(placed('0.5.0', standing()), (next) =>
            Effect.gen(function* () {
              return yield* until(next, (frame) => frame.issue?.code === 'source-unreadable');
            }),
          );
          expect(absent.offers).toEqual([]);
          expect(absent.issue?.reason).toContain('404');

          world.feedAt = '';
          const unfed = yield* channel(placed('0.5.0', standing()), (next) => until(next, (frame) => frame.back !== null));
          world.feedAt = `${world.url}/feed.json`;
          expect([unfed.readFrom, unfed.offers, unfed.issue]).toEqual([null, [], null]);
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { fourth, releaseOf, standing, channel, placed, until } = world;
          world.feed = { releases: [releaseOf('0.5.0', fourth, false)] };
          const seen = yield* channel(placed('0.5.0', standing()), (next) =>
            Effect.gen(function* () {
              const before = yield* until(next, (frame) => frame.standing.tone === 'latest');
              world.feed = { releases: [releaseOf('0.6.0', fourth, false), releaseOf('0.5.0', fourth, false)] };
              return { before, checked: yield* next.check };
            }),
          );
          expect(seen.before.update).toBeNull();
          expect(seen.checked.update).toBe('0.6.0');
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { packed, releaseOf, standing, channel, placed, until, ended, restarts, places } = world;
          const files = yield* FileSystem.FileSystem;
          let interrupted: string | null = null;
          const storage: FileSystem.FileSystem = {
            ...files,
            remove: Effect.fnUntraced(function* (path, options) {
              if (path === join(places.staging, '0.8.0') && existsSync(path)) interrupted = readFileSync(places.record, 'utf8');
              yield* files.remove(path, options);
            }),
          };
          const before = standing();
          const asked = restarts.length;
          const archive = yield* packed('0.8.0');
          world.feed = { releases: [releaseOf('0.8.0', archive, false)] };
          const place = placed('0.5.0', before);
          const held = yield* channel(
            { ...place, env: { ...place.env, TAGMA_TEST_HOST_REFUSAL: 'the standing host cannot accept this bundle' } },
            (next) =>
              Effect.gen(function* () {
                yield* until(next, (frame) => frame.offers[0]?.id === '0.8.0');
                const { installing } = yield* next.install('0.8.0', 'restart', null);
                return yield* ended(next, installing.since);
              }),
            storage,
          );
          expect(held.installed).toMatchObject({ outcome: 'stopped', placement: { status: 'held', build: '0.8.0' } });
          expect(standing()).toBe(before);
          expect(restarts.length).toBe(asked);
          const pending = held.installed?.placement;
          if (pending?.status !== 'held') return yield* Effect.die('the fixture needs its held placement');
          const reason = 'the release could not open this data format';
          writeAttempt(world.root, {
            from: before,
            to: pending.version,
            starts: 1,
            copied: true,
            ended: { detail: reason, data: 'restored' },
          });
          const retried = yield* channel(
            { ...place, env: { ...place.env, TAGMA_TEST_HOST_REFUSAL: 'the standing host cannot accept this bundle' } },
            (next) =>
              Effect.gen(function* () {
                const informed = yield* until(next, (frame) => frame.readFrom !== null);
                expect(informed.offers[0]?.detail).toContain(reason);
                const { installing } = yield* next.install('0.8.0', 'restart', null);
                return yield* ended(next, installing.since);
              }),
            storage,
          );
          expect(retried.installed).toMatchObject({ outcome: 'stopped', placement: { status: 'held', build: '0.8.0' } });
          expect(interrupted).not.toBeNull();
          writeFileSync(places.record, interrupted!);
          const reopened = yield* channel(place, (next) => next.reading);
          expect(reopened.installed).toMatchObject({
            since: retried.installed?.since,
            outcome: 'stopped',
            placement: { status: 'held', build: '0.8.0' },
          });
          expect(standing()).toBe(before);
          expect(restarts.length).toBe(asked);
        });

        yield* Effect.gen(function* () {
          const world = yield* World;
          const { packed, releaseOf, standing, channel, placed, until, ended, places, home } = world;
          const before = standing();
          const witness = join(home, 'installer-entered');
          const variants = [
            { offered: '0.9.0', build: '0.8.1', platform: world.platform, changes: undefined },
            {
              offered: '0.10.0',
              build: '0.10.0',
              platform: { ...world.platform, arch: world.platform.arch === 'arm64' ? 'x64' : 'arm64' },
              changes: undefined,
            },
            { offered: '0.11.0', build: '0.11.0', platform: world.platform, changes: [{ store: 'graph' as const, release: '0.11.0' }] },
          ];
          for (const variant of variants) {
            const archive = yield* packed(variant.build, variant.changes, variant.platform);
            world.feed = { releases: [releaseOf(variant.offered, archive, false, `${world.url}/archive/${variant.build}.tar.gz`)] };
            const place = placed('0.5.0', before);
            const refused = yield* channel({ ...place, env: { ...place.env, TAGMA_TEST_INSTALL_ENTRY: witness } }, (next) =>
              Effect.gen(function* () {
                yield* until(next, (frame) => frame.offers[0]?.id === variant.offered);
                const { installing } = yield* next.install(variant.offered, null, null);
                return yield* ended(next, installing.since);
              }),
            );
            expect(refused.installed?.outcome).toBe('failed');
            expect(standing()).toBe(before);
            expect(existsSync(witness)).toBe(false);
            expect(existsSync(places.staging)).toBe(false);
          }
          const changes = [{ store: 'graph' as const, release: '0.11.0' }];
          const archive = yield* packed('0.12.0', changes);
          world.feed = { releases: [{ ...releaseOf('0.12.0', archive, false), changes }] };
          const accepted = yield* channel(placed('0.5.0', before), (next) =>
            Effect.gen(function* () {
              yield* until(next, (frame) => frame.offers[0]?.id === '0.12.0');
              const { installing } = yield* next.install('0.12.0', null, null);
              return yield* ended(next, installing.since);
            }),
          );
          expect(accepted.installed).toMatchObject({ outcome: 'landed', build: '0.12.0' });
          expect(world.buildOf(standing())).toBe('0.12.0');
          const extra = yield* packed('0.12.1');
          const unused = yield* installRelease(
            carriedIn(extra.bundle),
            { installRoot: world.root, launcher: join(home, '.tagma/bin/tagma'), name: CHANNELS.stable.name },
            trustedApplications,
            new Date(yield* Clock.currentTimeMillis),
            false,
            () => Effect.succeed({ _tag: 'Refuses', detail: 'this version was kept without becoming current' }),
          );
          expect(unused.status).toBe('held');
          const nextArchive = yield* packed('0.13.0');
          world.feed = { releases: [releaseOf('0.13.0', nextArchive, false)] };
          const warning = join(home, 'prune-refused');
          const cliPlace = placed('0.12.0', standing());
          const warned = yield* channel(
            { ...cliPlace, env: { ...cliPlace.env, TAGMA_TEST_CLI_JSON: '1', TAGMA_TEST_PRUNE_ENTRY: warning } },
            (next) =>
              Effect.gen(function* () {
                yield* until(next, (frame) => frame.offers[0]?.id === '0.13.0');
                const { installing } = yield* next.install('0.13.0', 'restart', null);
                return yield* ended(next, installing.since);
              }),
          );
          expect(warned.installed).toMatchObject({ outcome: 'landed', build: '0.13.0', placement: { status: 'landed' } });
          expect(existsSync(warning)).toBe(true);
          expect(world.buildOf(standing())).toBe('0.13.0');
        });
      }),
  );
});
