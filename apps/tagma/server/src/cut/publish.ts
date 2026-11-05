import { join, resolve } from 'node:path';
import { Data, Effect, FileSystem, Layer, type PlatformError, Schedule } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { refusalLines } from '@runlith/agent/tool/refusal';
import {
  compareReleases,
  type Feed,
  FEED_FILE,
  type FeedRelease,
  newestOf,
  releaseOfTag,
  tagOf,
} from '../installation/contract/wire/feed.js';
import { dataDirectory } from '../installation/contract/wire/layout.js';
import type { Composition, CutMachine, Publisher, PublishTrouble } from './descriptor.js';
import { keepMaps, keptMapsOf } from './maps.js';
import type { Notary } from './platform.js';
import { flagsOf, KEPT_MAPS, publishedBy, RELEASE_DIRECTORY, releaseCommand } from './pipeline.js';
import { releaseNotes } from './notes.js';
import { checkoutTags, highestOf, precedingOf } from './published.js';
import {
  decodeRecord,
  feedEntry,
  homeOf,
  imagesWeighed,
  landNotarized,
  MAPS,
  openHome,
  provenCut,
  recordedInPlace,
  standingHome,
  RELEASE_RECORD,
  type ReleaseRecord,
} from './stage.js';

const USAGE = 'bun run tagma:release publish [--version <x.y.z>] [--out <dir>] [--json]';

export class PublishRefused extends Data.TaggedError('PublishRefused')<{
  readonly step: string;
  readonly detail: string;
  readonly unblock: readonly string[];
}> {}

export type Published = {
  readonly release: string;
  readonly page: string | null;
  readonly platforms: Readonly<Record<string, string>>;
  readonly images: Readonly<Record<string, string>>;
  readonly maps: string;
};

const refused = (step: string, detail: string, unblock: readonly string[] = []) =>
  new PublishRefused({ step, detail, unblock: [...unblock] });

const AGAIN = 'bun run tagma:release publish — publishing again takes up what stands';
const FEED_ASKED_EVERY = '10 seconds';
const FEED_ASKED = 12;
const RECUT = 'bun run tagma:release, then bun run tagma:release publish — the cut takes the next number';

const troubled = (step: string) => (trouble: PublishTrouble) =>
  refused(step, trouble.detail, trouble.unblock.length > 0 ? trouble.unblock : [AGAIN]);

const unreadableIn = (step: string) => (path: string) => (error: PlatformError.PlatformError) =>
  refused(step, `${path} could not be read: ${error.reason._tag}`);

type Standing = { readonly record: ReleaseRecord; readonly home: string };

const sameArchives = (offered: FeedRelease['platforms'], cut: FeedRelease['platforms']): boolean =>
  Object.keys(offered).length === Object.keys(cut).length &&
  Object.entries(cut).every(([platform, one]) => {
    const there = offered[platform];
    return there?.archive === one.archive && there.sha256 === one.sha256 && there.size === one.size;
  });

const cutStanding = Effect.fnUntraced(function* (cut: string): Effect.fn.Return<Standing, PublishRefused, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  const unreadable = unreadableIn('release');
  const present = (path: string) => files.exists(path).pipe(Effect.mapError(unreadable(path)));
  const home = yield* standingHome(cut).pipe(Effect.mapError((failure) => refused('release', failure.detail, failure.unblock)));
  const recordPath = join(home ?? cut, RELEASE_RECORD);
  if (home === null || !(yield* present(recordPath))) {
    return yield* refused('release', `no release is cut in ${cut}: ${recordPath} is absent`, ['bun run tagma:release']);
  }
  const decoded = decodeRecord(yield* files.readFileString(recordPath).pipe(Effect.mapError(unreadable(recordPath))));
  if (decoded._tag === 'Failure') {
    return yield* refused('release', `${recordPath} does not read as a release record: ${decoded.failure.message}`, [RECUT]);
  }
  const record = decoded.success;
  for (const [platform, one] of Object.entries(record.platforms)) {
    if (record.images[platform] === undefined) {
      return yield* refused('release', `${recordPath} names no disk image of ${platform}`, [RECUT]);
    }
    for (const path of [join(home, one.archive), join(home, record.images[platform])]) {
      if (!(yield* present(path))) return yield* refused('release', `${path}, which ${RELEASE_RECORD} names, is absent`, [RECUT]);
    }
  }
  yield* provenCut(home, record).pipe(Effect.mapError((failure) => refused(failure.step, failure.detail, [RECUT])));
  return { record, home };
});

const notarizedCut = Effect.fnUntraced(function* (
  notary: Notary,
  cut: string,
  standing: Standing,
): Effect.fn.Return<Standing, PublishRefused, FileSystem.FileSystem> {
  if (standing.record.notarized && imagesWeighed(standing.record)) return standing;
  const failed = (failure: { readonly detail: string; readonly unblock: readonly string[] }) =>
    refused('notarization', failure.detail, failure.unblock);
  const sealedBefore = standing.record.notarized;
  const into = sealedBefore ? standing.home : homeOf(cut, { ...standing.record, notarized: true });
  if (!sealedBefore) yield* openHome(into).pipe(Effect.mapError(failed));
  const record = yield* notary.seal(standing.home, into, standing.record).pipe(Effect.mapError(failed));
  if (!imagesWeighed(record)) {
    return yield* refused('notarization', `the notary sealed ${record.release} without the digest of every disk image`, [AGAIN]);
  }
  const home = sealedBefore
    ? yield* recordedInPlace(standing.home, record).pipe(Effect.mapError(failed))
    : yield* landNotarized(cut, standing.home, record).pipe(Effect.mapError(failed));
  return { record, home };
});

export const notarizeRelease = Effect.fnUntraced(function* (notary: Notary, cut: string) {
  return yield* notarizedCut(notary, cut, yield* cutStanding(cut));
});

const verified = Effect.fnUntraced(function* (publisher: Publisher, release: string, home: string, shipped: readonly string[]) {
  const files = yield* FileSystem.FileSystem;
  const newest = yield* publishedBy(publisher).pipe(
    Effect.mapError(troubled('verify')),
    Effect.map((feed) => (feed === null ? null : newestOf(feed).release)),
    Effect.repeat({ until: (seen) => seen === release, schedule: Schedule.spaced(FEED_ASKED_EVERY), times: FEED_ASKED }),
  );
  if (newest !== release) {
    return yield* refused('verify', `${publisher.place} offers ${newest ?? 'no release'} as its newest, and ${release} was placed`, [
      AGAIN,
    ]);
  }
  yield* Effect.forEach(
    shipped,
    Effect.fnUntraced(function* (name) {
      const path = join(home, name);
      const size = Number((yield* files.stat(path).pipe(Effect.mapError(unreadableIn('verify')(path)))).size);
      const served = yield* publisher.served(release, name).pipe(Effect.mapError(troubled('verify')));
      if (served === size) return;
      return yield* refused(
        'verify',
        `${publisher.address(release, name)} serves ${served === null ? 'nothing' : `${served} bytes`}, and ${release} placed ${size}`,
        [AGAIN],
      );
    }),
    { concurrency: 'unbounded', discard: true },
  );
});

export type Publishing = {
  readonly cut: string;
  readonly checkout: string;
  readonly kept: string;
};

const checkoutCommit = Effect.fnUntraced(function* (checkout: string, record: ReleaseRecord) {
  const git = yield* Git;
  const resolved = yield* git
    .run(['rev-parse', '--verify', '--quiet', `${record.commit}^{commit}`], { cwd: checkout })
    .pipe(Effect.mapError((failure) => refused('commit', failure.message, [AGAIN])));
  if (resolved.status !== 0) {
    return yield* refused('commit', `${record.commit}, which ${record.release} was cut from, is no commit of ${checkout}`, [
      'bun run tagma:release publish from the checkout the release was cut in',
    ]);
  }
  const commit = resolved.stdout.trim();
  const tag = tagOf(record.release);
  const tagged = yield* git
    .run(['tag', '--list', tag, '--format=%(objectname)'], { cwd: checkout })
    .pipe(Effect.mapError((failure) => refused('tag', failure.message, [AGAIN])));
  const standing = tagged.stdout.trim();
  if (standing !== '' && standing !== commit) {
    return yield* refused('tag', `${tag} in ${checkout} names ${standing}, and ${record.release} was cut from ${commit}`, [
      `git tag -d ${tag}, if it names nothing published`,
    ]);
  }
  return { commit, tagged: standing !== '' };
});

export const publishRelease = (
  publisher: Publisher,
  notary: Notary,
  { cut, checkout, kept }: Publishing,
): Effect.Effect<Published, PublishRefused, CutMachine> =>
  Effect.scoped(
    Effect.gen(function* () {
      const git = yield* Git;
      const unreadable = unreadableIn('release');
      const stood = yield* cutStanding(cut);
      const { release } = stood.record;
      const tag = tagOf(release);
      const { commit, tagged } = yield* checkoutCommit(checkout, stood.record);
      const latest = yield* publishedBy(publisher).pipe(Effect.mapError(troubled('feed')));
      const tags = yield* checkoutTags(checkout).pipe(Effect.mapError(troubled('tag')));
      const newest = latest === null ? null : newestOf(latest);
      const placed = newest !== null && newest.release === release ? newest : null;
      if (placed === null) {
        if (tagged) {
          return yield* refused(
            'version',
            `${tag} stands in ${checkout}, so ${release} was published from it once, and ${publisher.place} does not offer it as its newest release now; a number is published once`,
            [RECUT],
          );
        }
        const highest = highestOf(latest, tags);
        if (highest !== null && compareReleases(release, highest) <= 0) {
          return yield* refused(
            'version',
            `${highest} is published in ${publisher.place}, and a release is published over every one before it`,
            [RECUT],
          );
        }
      }
      const previous = precedingOf(latest, tags, release);
      const notes = yield* releaseNotes(checkout, previous !== null && tags.includes(previous) ? tagOf(previous) : null, commit).pipe(
        Effect.mapError((failure) => refused('notes', failure.detail, [AGAIN])),
      );

      const { record, home } = yield* notarizedCut(notary, cut, stood);
      const address = (name: string): string => publisher.address(release, name);
      const entry = feedEntry(record, address);
      if (placed !== null && !sameArchives(placed.platforms, entry.platforms)) {
        return yield* refused(
          'feed',
          `${publisher.place} already offers ${release} with other archives than this cut carries, and bytes under a published number are never swapped`,
          [RECUT],
        );
      }
      const feed: Feed = {
        releases: [entry, ...(latest?.releases ?? []).filter((one) => compareReleases(one.release, release) < 0)],
      };
      const shipped = [...Object.values(record.platforms).map((one) => one.archive), ...Object.values(record.images)];
      const landed = yield* publisher.publish({ record, home, files: shipped, feed, notes }).pipe(Effect.mapError(troubled('publish')));
      yield* verified(publisher, release, home, shipped);

      const maps = yield* keepMaps(home, kept, { release, commit }).pipe(Effect.mapError(unreadable(join(home, MAPS))));

      if (!tagged) {
        yield* git.run(['tag', tag, commit], { cwd: checkout }).pipe(
          Effect.mapError((failure) => refused('tag', failure.message, [AGAIN])),
          Effect.flatMap((answer) =>
            answer.status === 0
              ? Effect.void
              : Effect.fail(refused('tag', `git tag ${tag} exited ${answer.status}: ${answer.stderr.trim()}`, [AGAIN])),
          ),
        );
      }

      return {
        release,
        page: landed.page,
        platforms: Object.fromEntries(Object.entries(record.platforms).map(([platform, one]) => [platform, address(one.archive)])),
        images: Object.fromEntries(Object.entries(record.images).map(([platform, name]) => [platform, address(name)])),
        maps,
      } satisfies Published;
    }),
  );

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer);

type Told = (code: string, reason: string, unblock?: readonly string[]) => never;

const notaryOf = Effect.fnUntraced(function* (composition: Composition, told: Told): Effect.fn.Return<Notary> {
  const { platform } = composition;
  const signer = yield* Effect.result(platform.releaseSigner(composition.signing.team).pipe(Effect.provide(machine)));
  if (signer._tag === 'Failure') return told('signing-refused', signer.failure.detail, signer.failure.unblock);
  const notary = yield* Effect.result(
    platform.notary(signer.success, composition.brand.assets, composition.signing.notary).pipe(Effect.provide(machine)),
  );
  if (notary._tag === 'Failure') return told('signing-refused', notary.failure.detail, notary.failure.unblock);
  return notary.success;
});

const NOTARIZE_USAGE = 'bun run tagma:release notarize [--out <dir>] [--json]';

const toldBy =
  (usage: string, json: () => boolean): Told =>
  (code, reason, unblock = [usage]) => {
    if (json()) console.log(JSON.stringify({ code, reason, unblock }));
    else console.error(refusalLines({ code, reason, unblock: [...unblock] }).join('\n'));
    process.exit(2);
  };

const cutIn = (composition: Composition, named: string | undefined, told: Told) => {
  const data = dataDirectory(composition.workshop, process.env);
  if (data === null) return told('no-home', 'HOME names no home directory, so where the release is cut is unknown');
  return { data, cut: named === undefined ? join(data, RELEASE_DIRECTORY) : resolve(named) };
};

export const notarizeCommand = Effect.fnUntraced(function* (given: readonly string[], composition: Composition, shown = true) {
  let json = given.includes('--json');
  const told = toldBy(NOTARIZE_USAGE, () => json);
  const flags = flagsOf(given, told);
  json = flags.json;
  if (flags.rest.length > 0) told('usage', `${flags.rest.join(' ')} is not understood: notarizing takes the release that is cut`);
  const { cut } = cutIn(composition, flags.value('--out'), told);
  const notary = yield* notaryOf(composition, told);
  const outcome = yield* Effect.result(notarizeRelease(notary, cut).pipe(Effect.provide(machine)));
  if (outcome._tag === 'Failure') {
    return told('notarize-refused', `${outcome.failure.step}: ${outcome.failure.detail}`, outcome.failure.unblock);
  }
  if (!shown) return;
  const { record, home } = outcome.success;
  if (json) {
    console.log(JSON.stringify({ ...record, home }, null, 2));
    return;
  }
  for (const line of [
    `${composition.channel.name} ${record.release} is notarized by Apple and stapled; nothing is published`,
    ...Object.entries(record.platforms).flatMap(([platform, one]) => [
      `application ${platform} ${join(home, record.images[platform] ?? '')} — opens without a warning on a Mac of its kind`,
      `update archive ${platform} ${join(home, one.archive)}, sha256 ${one.sha256}`,
    ]),
    composition.publisher === null
      ? 'this distribution names no publisher, so the release is placed by hand'
      : 'bun run tagma:release publish — publishes it without sending it to Apple again',
  ])
    console.log(line);
});

export const cutCommand = Effect.fnUntraced(function* (given: readonly string[], composition: Composition) {
  yield* releaseCommand(given, composition, !given.includes('--json'));
  yield* notarizeCommand(given, composition);
});

type Head =
  | { readonly _tag: 'Released'; readonly release: string; readonly commit: string; readonly home: string | null }
  | { readonly _tag: 'Cut' }
  | { readonly _tag: 'Uncut' };

const headOf = Effect.fnUntraced(function* (checkout: string, cut: string): Effect.fn.Return<Head, PublishRefused, CutMachine> {
  const files = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const asked = (args: readonly string[]) =>
    git.run(args, { cwd: checkout }).pipe(Effect.mapError((failure) => refused('head', `git ${args[0]}: ${failure.message}`, [AGAIN])));
  const head = yield* asked(['rev-parse', 'HEAD']);
  if (head.status !== 0) return yield* refused('head', `git rev-parse HEAD exited ${head.status}: ${head.stderr.trim()}`, [AGAIN]);
  const commit = head.stdout.trim();
  const tagged = yield* asked(['tag', '--points-at', commit, '--list', tagOf('*')]);
  if (tagged.status !== 0) return yield* refused('head', `git tag --points-at exited ${tagged.status}: ${tagged.stderr.trim()}`, [AGAIN]);
  const released = tagged.stdout
    .split('\n')
    .map((line) => releaseOfTag(line.trim()))
    .filter((release) => release !== null)
    .sort((one, other) => compareReleases(other, one))[0];
  const unread = (path: string) => (error: PlatformError.PlatformError) => refused('head', `${path}: ${error.reason._tag}`, [AGAIN]);
  const cutAtHead = Effect.gen(function* () {
    const home = yield* standingHome(cut).pipe(Effect.mapError((failure) => refused('head', failure.detail, failure.unblock)));
    const recordPath = join(home ?? cut, RELEASE_RECORD);
    const present = yield* files.exists(recordPath).pipe(Effect.mapError(unread(recordPath)));
    if (home === null || !present) return null;
    const decoded = decodeRecord(yield* files.readFileString(recordPath).pipe(Effect.mapError(unread(recordPath))));
    if (decoded._tag === 'Failure') {
      return yield* refused('record', `${recordPath} does not read as a release record: ${decoded.failure.message}`, [
        `move the unreadable cut at ${home} aside, then run the same command again`,
      ]);
    }
    const cutFrom = yield* asked(['rev-parse', '--verify', '--quiet', `${decoded.success.commit}^{commit}`]);
    return cutFrom.status === 0 && cutFrom.stdout.trim() === commit ? { record: decoded.success, home } : null;
  });
  const standing = yield* cutAtHead;
  if (released !== undefined) {
    return { _tag: 'Released', release: released, commit, home: standing?.record.release === released ? standing.home : null };
  }
  return standing === null ? { _tag: 'Uncut' } : { _tag: 'Cut' };
});

export const needsReleaseSource = (checkout: string, cut: string): Effect.Effect<boolean, PublishRefused> =>
  headOf(checkout, cut).pipe(
    Effect.map((head) => head._tag === 'Uncut'),
    Effect.provide(machine),
  );

const completedMaps = Effect.fnUntraced(function* (
  kept: string,
  head: { readonly release: string; readonly commit: string; readonly home: string | null },
): Effect.fn.Return<'kept' | 'repaired' | 'unverified', PublishRefused, FileSystem.FileSystem> {
  const one = { release: head.release, commit: head.commit };
  const state = yield* keptMapsOf(kept, one).pipe(
    Effect.mapError((error) => refused('maps', `${join(kept, head.release)} could not be read: ${error.reason._tag}`)),
  );
  if (state === 'complete') return 'kept';
  if (head.home === null) {
    if (state === 'unverified') return 'unverified';
    return yield* refused(
      'maps',
      `the source maps of ${head.release} are not kept in ${join(kept, head.release)}, and no standing cut of ${head.release} at HEAD holds them`,
      [`bun run tagma:stack reads maps only from ${kept} or a cut; the machine that published ${head.release} keeps them`],
    );
  }
  yield* keepMaps(head.home, kept, one).pipe(
    Effect.mapError((error) =>
      refused('maps', `the source maps of ${head.release} could not be kept from ${head.home}: ${error.reason._tag}`, [
        `the cut at ${head.home} holds no complete ${MAPS} directory, so they cannot be recovered from it`,
      ]),
    ),
  );
  return 'repaired';
});

export const shipCommand = Effect.fnUntraced(function* (given: readonly string[], composition: Composition) {
  let json = given.includes('--json');
  const told = toldBy(USAGE, () => json);
  const flags = flagsOf(given, told);
  json = flags.json;
  const { data, cut } = cutIn(composition, flags.value('--out'), told);
  const head = yield* Effect.result(headOf(composition.roots.checkout, cut).pipe(Effect.provide(machine)));
  if (head._tag === 'Failure') {
    return told('publish-refused', `${head.failure.step}: ${head.failure.detail}`, head.failure.unblock);
  }
  if (head.success._tag === 'Released') {
    const { release } = head.success;
    const maps = yield* Effect.result(completedMaps(join(data, KEPT_MAPS), head.success).pipe(Effect.provide(machine)));
    if (maps._tag === 'Failure') return told('maps-refused', maps.failure.detail, maps.failure.unblock);
    if (json) console.log(JSON.stringify({ release, published: true, maps: maps.success }));
    else
      console.log(
        `${composition.channel.name} ${release} is HEAD and is published; a commit is released once; its source maps are ${maps.success === 'kept' ? 'kept' : maps.success === 'repaired' ? 'kept again from the standing cut' : 'kept, but nothing proves them whole'}`,
      );
    return;
  }
  if (head.success._tag === 'Uncut') yield* releaseCommand(given, composition, !json);
  yield* notarizeCommand(given, composition, !json);
  yield* publishCommand(given, composition);
});

const publishCommand = Effect.fnUntraced(function* (given: readonly string[], composition: Composition) {
  const { checkout } = composition.roots;
  let json = given.includes('--json');
  const told = toldBy(USAGE, () => json);
  const flags = flagsOf(given, told);
  json = flags.json;
  if (flags.rest.length > 0) told('usage', `${flags.rest.join(' ')} is not understood: publishing takes the release that is cut`);
  const { publisher } = composition;
  if (publisher === null) {
    return told('no-publisher', `${composition.channel.name} names no publisher, so this distribution publishes nothing`, [
      'bun run tagma:release notarize — notarizes the cut, which is then placed by hand',
    ]);
  }
  const { data, cut } = cutIn(composition, flags.value('--out'), told);
  const notary = yield* notaryOf(composition, told);
  const outcome = yield* Effect.result(
    publishRelease(publisher, notary, { cut, checkout, kept: join(data, KEPT_MAPS) }).pipe(Effect.provide(machine)),
  );
  if (outcome._tag === 'Failure') {
    return told('publish-refused', `${outcome.failure.step}: ${outcome.failure.detail}`, outcome.failure.unblock);
  }
  const done = outcome.success;
  if (json) {
    console.log(JSON.stringify({ ...done, place: publisher.place, feed: composition.feed }, null, 2));
    return;
  }
  for (const line of [
    `${composition.channel.name} ${done.release} published in ${publisher.place}${done.page === null ? '' : ` — ${done.page}`}`,
    ...Object.entries(done.platforms).flatMap(([platform, archive]) => [
      `application ${platform} ${done.images[platform] ?? 'missing'}`,
      `update archive ${platform} ${archive}`,
    ]),
    composition.feed === null
      ? `${FEED_FILE} is placed, and a release of this distribution reads only the release.feed setting`
      : `${composition.channel.name} reads the feed from ${composition.feed}`,
    `tag ${tagOf(done.release)} in ${checkout}; source maps kept in ${done.maps}`,
  ])
    console.log(line);
});
