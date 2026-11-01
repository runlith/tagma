import { join, resolve } from 'node:path';
import { Data, Effect, FileSystem, Layer, type PlatformError } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { compareReleases, type Feed, FEED_FILE, tagOf } from '../contract/wire/feed.js';
import { dataDirectory } from '../contract/wire/layout.js';
import { developerTeam, releaseIdentity } from '../setup/signing.js';
import type { Composition, CutMachine, Publisher, PublishTrouble } from './descriptor.js';
import { appleNotary, type Notary } from './notarize.js';
import { flagsOf, KEPT_MAPS, publishedBy, RELEASE_DIRECTORY } from './pipeline.js';
import { releaseNotes } from './notes.js';
import { checkoutTags, highestOf, precedingOf } from './published.js';
import {
  decodeRecord,
  digestOf,
  feedEntry,
  homeOf,
  landNotarized,
  MAPS,
  openHome,
  standingHome,
  RELEASE_RECORD,
  type ReleaseRecord,
} from './stage.js';

const USAGE = 'bun run tagma:release publish [--out <dir>] [--json]';

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
const RECUT = 'bun run tagma:release, then bun run tagma:release publish — the cut takes the next number';

const troubled = (step: string) => (trouble: PublishTrouble) =>
  refused(step, trouble.detail, trouble.unblock.length > 0 ? trouble.unblock : [AGAIN]);

const unreadableIn = (step: string) => (path: string) => (error: PlatformError.PlatformError) =>
  refused(step, `${path} could not be read: ${error.reason._tag}`);

type Standing = { readonly record: ReleaseRecord; readonly home: string };

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
  for (const one of Object.values(record.platforms)) {
    const path = join(home, one.archive);
    const size = Number((yield* files.stat(path).pipe(Effect.mapError(unreadable(path)))).size);
    const sha256 = yield* Effect.tryPromise({
      try: () => digestOf(path),
      catch: (error) => refused('release', `${path} could not be read: ${String(error)}`),
    });
    if (size !== one.size || sha256 !== one.sha256) {
      return yield* refused(
        'archive',
        `${path} is ${size} bytes with sha256 ${sha256}, and ${RELEASE_RECORD} records ${one.size} bytes with sha256 ${one.sha256}`,
        [RECUT],
      );
    }
  }
  return { record, home };
});

const notarizedCut = Effect.fnUntraced(function* (
  notary: Notary,
  cut: string,
  standing: Standing,
): Effect.fn.Return<Standing, PublishRefused, FileSystem.FileSystem> {
  if (standing.record.notarized) return standing;
  const failed = (failure: { readonly detail: string; readonly unblock: readonly string[] }) =>
    refused('notarization', failure.detail, failure.unblock);
  const into = homeOf(cut, { ...standing.record, notarized: true });
  yield* openHome(into).pipe(Effect.mapError(failed));
  const record = yield* notary.seal(standing.home, into, standing.record).pipe(Effect.mapError(failed));
  const home = yield* landNotarized(cut, standing.home, record).pipe(Effect.mapError(failed));
  return { record, home };
});

export const notarizeRelease = Effect.fnUntraced(function* (notary: Notary, cut: string) {
  return yield* notarizedCut(notary, cut, yield* cutStanding(cut));
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
      const files = yield* FileSystem.FileSystem;
      const git = yield* Git;
      const unreadable = unreadableIn('release');
      const stood = yield* cutStanding(cut);
      const { release } = stood.record;
      const tag = tagOf(release);
      const { commit, tagged } = yield* checkoutCommit(checkout, stood.record);
      const latest = yield* publishedBy(publisher).pipe(Effect.mapError(troubled('feed')));
      const tags = yield* checkoutTags(checkout).pipe(Effect.mapError(troubled('tag')));
      const placed = latest?.releases.some((one) => one.release === release) ?? false;
      if (!placed) {
        if (tagged) {
          return yield* refused(
            'version',
            `${tag} stands in ${checkout}, so ${release} was published from it once, and ${publisher.place} offers no ${release} now; a number is published once`,
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
      const feed: Feed = {
        releases: [feedEntry(record, address), ...(latest?.releases ?? []).filter((one) => compareReleases(one.release, release) < 0)],
      };
      const shipped = [...Object.values(record.platforms).map((one) => one.archive), ...Object.values(record.images)];
      const landed = yield* publisher.publish({ record, home, files: shipped, feed, notes }).pipe(Effect.mapError(troubled('publish')));

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
      const maps = join(kept, release);
      yield* files.remove(maps, { recursive: true, force: true }).pipe(Effect.mapError(unreadable(maps)));
      yield* files.makeDirectory(kept, { recursive: true }).pipe(Effect.mapError(unreadable(kept)));
      yield* files.copy(join(home, MAPS), maps, { overwrite: true }).pipe(Effect.mapError(unreadable(join(home, MAPS))));

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
  const signer = yield* Effect.result(releaseIdentity.pipe(Effect.provide(machine)));
  if (signer._tag === 'Failure') return told('signing-refused', signer.failure.detail, signer.failure.unblock);
  const team = developerTeam(signer.success);
  if (team === null) return told('signing-refused', `"${signer.success.name}" names no Developer ID team`);
  return yield* appleNotary({
    signing: { identity: signer.success.fingerprint, timestamp: true },
    team,
    assets: composition.brand.assets,
    profile: composition.signing.notary,
  }).pipe(Effect.provide(machine));
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

export const notarizeCommand = Effect.fnUntraced(function* (given: readonly string[], composition: Composition) {
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

export const publishCommand = Effect.fnUntraced(function* (given: readonly string[], composition: Composition) {
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
