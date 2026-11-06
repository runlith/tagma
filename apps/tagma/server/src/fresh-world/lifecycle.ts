import { basename, join } from 'node:path';
import { Effect, FileSystem, Layer, Semaphore } from 'effect';
import { HttpClient } from 'effect/http';
import { GateRefusal, type Unblock } from '../platform/contract/wire/refusal.js';
import { compareReleases, isRelease, newestOf } from '../installation/contract/wire/feed.js';
import { readFeed } from '../release-channel/feed.js';
import { downloaded } from '../release-channel/delivery.js';
import { openArchive } from '../release-channel/archive.js';
import type { FreshHost, FreshPlace, FreshProcess, HostFailed } from './contract/service/host.js';
import { FreshWorld, type FreshRefusal, type Opening, type Standing } from './contract/service/world.js';

const ASKED_EVERY = '250 millis';
const AGAIN = 'open_fresh_world again once the step it names can run on this Mac';
const ROOT = '.tagma-fresh';
const KEPT = 'fresh';

type FreshOptions = {
  readonly home: string;
  readonly data: string;
  readonly feed: string | null;
  readonly url: string;
  readonly host: FreshHost;
};

const refused = <Code extends FreshRefusal>(code: Code, reason: string, unblock: Unblock) => new GateRefusal<Code>(code, reason, unblock);

const hostRefused = (failure: HostFailed) => refused('fresh-host', failure.message, [AGAIN]);

const onHost = <A>(effect: Effect.Effect<A, HostFailed>) => Effect.mapError(effect, hostRefused);

const unavailable = (detail: string) => refused('fresh-unavailable', detail, ['open_fresh_world again once it can be reached']);

const makeFreshWorld = Effect.fnUntraced(function* (options: FreshOptions) {
  const files = yield* FileSystem.FileSystem;
  const client = yield* HttpClient.HttpClient;
  const turn = yield* Semaphore.make(1);
  const { host } = options;
  const root = join(options.home, ROOT);
  const place: FreshPlace = { home: join(root, 'home'), tmp: join(root, 'tmp') };
  const applications = join(place.home, 'Applications');
  const kept = join(options.data, KEPT, 'releases');
  const work = join(options.data, KEPT, 'work');

  const disk = (doing: string) => (failure: { readonly message: string }) => refused('fresh-host', `${doing}: ${failure.message}`, [AGAIN]);

  const removed = (path: string) =>
    files.remove(path, { recursive: true }).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.void),
      Effect.mapError(disk(`${path} could not be removed`)),
    );

  const made = (path: string) => files.makeDirectory(path, { recursive: true }).pipe(Effect.mapError(disk(`${path} could not be made`)));

  const bundleIn = Effect.fnUntraced(function* (dir: string) {
    const names = yield* files.readDirectory(dir).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed([] as string[])),
      Effect.mapError(disk(`${dir} could not be read`)),
    );
    const found = names.filter((name) => name.endsWith('.app')).sort()[0];
    return found === undefined ? null : join(dir, found);
  });

  const standing = Effect.fnUntraced(function* () {
    const bundle = yield* bundleIn(applications);
    const living = yield* onHost(host.processes(root));
    return { bundle, living };
  });

  const releaseOf = (bundle: string | null) => (bundle === null ? Effect.succeed(null) : onHost(host.version(bundle)));

  const answer = (release: string | null, running: boolean): Standing => ({ root, release, running, url: options.url });

  const gone = Effect.fnUntraced(function* (pids: readonly number[]) {
    const left = (living: readonly FreshProcess[]) => living.some((one) => pids.includes(one.pid));
    while (left(yield* onHost(host.processes(root)))) yield* Effect.sleep(ASKED_EVERY);
  });

  const stopped = Effect.fn('FreshWorld.stop')(function* (bundle: string | null) {
    const living = yield* onHost(host.processes(root));
    if (living.length === 0) return;
    if (bundle !== null) {
      const window = host.window(bundle);
      const windows = living.filter((one) => one.executable.startsWith(window)).map((one) => one.pid);
      if (windows.length > 0) {
        yield* host.signal(windows, 'SIGTERM');
        yield* gone(windows);
      }
      const unquit = yield* host.quit(bundle, place);
      if (unquit !== null) yield* Effect.logWarning(`the fresh world did not quit on its own, its processes are ended: ${unquit}`);
    }
    const left = (yield* onHost(host.processes(root))).map((one) => one.pid);
    if (left.length === 0) return;
    yield* host.signal(left, 'SIGKILL');
    yield* gone(left);
  });

  const wiped = Effect.fn('FreshWorld.wipe')(function* (bundle: string | null) {
    yield* stopped(bundle);
    if (bundle !== null) yield* onHost(host.forget(bundle));
    yield* removed(root);
    yield* onHost(host.unregister(root));
  });

  const unpacked = Effect.fn('FreshWorld.unpack')(function* (archive: string, into: string) {
    const opened = yield* openArchive(archive).pipe(Effect.mapError((failure) => unavailable(failure.detail)));
    yield* opened.unpack(into).pipe(Effect.mapError((failure) => unavailable(failure.detail)));
    const bundle = yield* bundleIn(into);
    if (bundle === null) return yield* unavailable(`${archive} carries no application at its root`);
    return bundle;
  }, Effect.scoped);

  const keptBundle = (release: string) => bundleIn(join(kept, release));

  const keptReleases = Effect.fnUntraced(function* () {
    const names = yield* files.readDirectory(kept).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed([] as string[])),
      Effect.mapError(disk(`${kept} could not be read`)),
    );
    const standing: string[] = [];
    for (const name of names.filter(isRelease)) if ((yield* keptBundle(name)) !== null) standing.push(name);
    return standing.toSorted((left, right) => compareReleases(right, left));
  });

  const fromFeed = Effect.fn('FreshWorld.release')(function* (release: string | null) {
    const standingKept = release === null ? null : yield* keptBundle(release);
    if (standingKept !== null) return standingKept;
    const feedAt = options.feed;
    const keptNow = yield* keptReleases();
    if (feedAt === null) {
      const newestKept = release === null ? keptNow[0] : undefined;
      if (newestKept !== undefined) return (yield* keptBundle(newestKept))!;
      return yield* refused('fresh-no-feed', 'this build was cut without a release feed, and no release it names is kept', [
        'open_fresh_world with from — a local .app, .dmg or release archive',
        ...keptNow.map((one) => `open_fresh_world with release ${one} — kept from an earlier start`),
      ]);
    }
    const feed = yield* readFeed(client, feedAt).pipe(
      Effect.mapError((issue) =>
        refused('fresh-unavailable', issue.reason, [
          ...issue.unblock,
          ...keptNow.map((one) => `open_fresh_world with release ${one} — kept, so it needs no feed`),
        ]),
      ),
    );
    const entry = release === null ? newestOf(feed) : feed.releases.find((one) => one.release === release);
    if (entry === undefined) {
      return yield* refused('fresh-no-release', `the feed at ${feedAt} lists no release ${release}`, [
        `open_fresh_world with one of ${feed.releases.map((one) => one.release).join(', ')}, or without release for the newest`,
      ]);
    }
    const standingEntry = yield* keptBundle(entry.release);
    if (standingEntry !== null) return standingEntry;
    const platform = yield* onHost(host.platform);
    const key = `${platform.os}-${platform.arch}`;
    const archive = entry.platforms[key];
    if (archive === undefined) {
      return yield* refused('fresh-no-release', `release ${entry.release} has no archive for this Mac's platform ${key}`, [
        'open_fresh_world with from — a local .app, .dmg or release archive for this Mac',
      ]);
    }
    const file = join(work, `${entry.release}-${key}.tar.gz`);
    const offered = { release: entry.release, platform, irreversible: entry.irreversible, changes: entry.changes, ...archive };
    const digest = yield* downloaded(client, offered, file, () => Effect.void).pipe(
      Effect.mapError((failure) => unavailable(failure.detail)),
    );
    if (digest !== archive.sha256) {
      return yield* unavailable(`the archive of release ${entry.release} hashes to ${digest}, and the feed declares ${archive.sha256}`);
    }
    const bundle = yield* unpacked(file, join(work, entry.release));
    const target = join(kept, entry.release);
    yield* made(target);
    const keptAt = join(target, basename(bundle));
    yield* files.rename(bundle, keptAt).pipe(Effect.mapError(disk(`${bundle} could not be kept in ${target}`)));
    return keptAt;
  });

  const fromLocal = Effect.fn('FreshWorld.from')(function* (from: string) {
    if (!(yield* files.exists(from).pipe(Effect.mapError(disk(`${from} could not be read`))))) {
      return yield* unavailable(`${from} does not exist`);
    }
    if (from.endsWith('.app')) return from;
    const into = join(work, 'from');
    if (from.endsWith('.dmg')) return yield* onHost(host.image(from, into));
    if (from.endsWith('.tar.gz')) return yield* unpacked(from, into);
    return yield* unavailable(`${from} is no .app, .dmg or release archive`);
  });

  const taken = Effect.fnUntraced(function* (opening: Opening) {
    yield* removed(work);
    yield* made(work);
    return opening.from !== null ? yield* fromLocal(opening.from) : yield* fromFeed(opening.release);
  });

  const opened = Effect.fnUntraced(function* (bundle: string, running: boolean) {
    yield* made(place.tmp);
    yield* onHost(host.keychain(place));
    yield* onHost(host.launch(bundle, place, running));
  });

  return FreshWorld.of({
    open: (opening) =>
      turn
        .withPermit(
          Effect.gen(function* () {
            const before = yield* standing();
            const over = opening.over || opening.release !== null || opening.from !== null;
            if (!over && before.bundle !== null) {
              const running = before.living.length > 0;
              const release = yield* releaseOf(before.bundle);
              yield* opened(before.bundle, running);
              return { ...answer(release, true), started: !running };
            }
            const source = yield* taken(opening);
            yield* wiped(before.bundle);
            yield* made(applications);
            const bundle = yield* onHost(host.place(source, applications));
            yield* removed(work);
            const release = yield* onHost(host.version(bundle));
            yield* opened(bundle, false);
            return { ...answer(release, true), started: true };
          }),
        )
        .pipe(Effect.withSpan('FreshWorld.open')),
    read: Effect.gen(function* () {
      const now = yield* standing();
      return answer(yield* releaseOf(now.bundle), now.living.length > 0);
    }).pipe(Effect.withSpan('FreshWorld.read')),
  });
});

export const freshWorldLayer = (options: FreshOptions) => Layer.effect(FreshWorld, makeFreshWorld(options));
