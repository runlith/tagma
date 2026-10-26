import { join, resolve } from 'node:path';
import { Data, Duration, Effect, FileSystem, Layer, type PlatformError, Schema } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { gitHubCli, type GitHubCli, type ProgramFailure } from '@runlith/github/GitHubCli';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { archivesOf, compareReleases, type Feed, LEGACY_PLATFORM } from '../contract/wire/feed.js';
import type { Channel } from '../contract/wire/channel.js';
import { dataDirectory } from '../contract/wire/layout.js';
import { developerTeam, releaseIdentity } from '../setup/signing.js';
import { appleNotary, type Notary } from './notarize.js';
import { checkoutOf, desktopAssets, flagsOf, KEPT_MAPS, RELEASE_DIRECTORY } from './pipeline.js';
import { FEED_BRANCH, FEED_FILE, FEED_REPOSITORY, feedRemote, publishedClone } from './published.js';
import {
  decodeRecord,
  digestOf,
  encodeFeed,
  feedEntry,
  homeOf,
  landNotarized,
  MAPS,
  openHome,
  standingHome,
  RELEASE_RECORD,
  type ReleaseRecord,
} from './stage.js';

const REPOSITORY = /^[\w.-]+\/[\w.-]+$/u;
const NOT_FOUND = /release not found/u;
const USAGE = 'bun run tagma:release publish [--repo <owner/name>] [--out <dir>] [--json]';

export const tagOf = (release: string): string => `v${release}`;

export class PublishRefused extends Data.TaggedError('PublishRefused')<{
  readonly step: string;
  readonly detail: string;
  readonly unblock: readonly string[];
}> {}

export type Published = {
  readonly release: string;
  readonly page: string;
  readonly platforms: Readonly<Record<string, string>>;
  readonly archive: string;
  readonly images: Readonly<Record<string, string>>;
  readonly feed: string | null;
  readonly maps: string;
};

const Asset = Schema.Struct({
  name: Schema.String,
  size: Schema.Int,
  url: Schema.String,
  state: Schema.String,
  digest: Schema.optional(Schema.NullOr(Schema.String)),
});
type Asset = typeof Asset.Type;
const GitHubRelease = Schema.Struct({ isDraft: Schema.Boolean, url: Schema.String, assets: Schema.Array(Asset) });
type GitHubRelease = typeof GitHubRelease.Type;
const decodeGitHubRelease = Schema.decodeUnknownResult(Schema.fromJsonString(GitHubRelease));

type Shipped = { readonly path: string; readonly name: string; readonly size: number; readonly sha256: string };

const fits = (assets: readonly Asset[], one: Shipped): Asset | undefined =>
  assets.find(
    (asset) =>
      asset.name === one.name &&
      asset.size === one.size &&
      asset.state === 'uploaded' &&
      (asset.digest == null || asset.digest === `sha256:${one.sha256}`),
  );

const refused = (step: string, detail: string, unblock: readonly string[] = []) =>
  new PublishRefused({ step, detail, unblock: [...unblock] });

const AGAIN = 'bun run tagma:release publish — publishing again takes up what stands';
const RECUT = 'bun run tagma:release, then bun run tagma:release publish';

const ghFailed = (step: string) => (failure: ProgramFailure) =>
  refused(
    step,
    `gh: ${failure.detail}`,
    failure._tag === 'ProgramUnavailable' ? ['install the GitHub CLI and sign in: gh auth login'] : [AGAIN],
  );

const viewed = (gh: GitHubCli, repo: string, tag: string, cwd: string): Effect.Effect<GitHubRelease | null, PublishRefused> =>
  gh.run(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,url,assets'], cwd).pipe(
    Effect.map((ended): string | null => ended.stdout),
    Effect.catchTag('ProgramFailed', (failure) =>
      failure.phase === 'exit' && NOT_FOUND.test(failure.stderr ?? '') ? Effect.succeed(null) : Effect.fail(failure),
    ),
    Effect.mapError(ghFailed('release')),
    Effect.flatMap((text) => {
      if (text === null) return Effect.succeed(null);
      const decoded = decodeGitHubRelease(text);
      return decoded._tag === 'Success'
        ? Effect.succeed(decoded.success)
        : Effect.fail(refused('release', `gh release view ${tag} answered what does not read as a release: ${decoded.failure.message}`));
    }),
  );

const digested = (path: string): Effect.Effect<string, PublishRefused> =>
  Effect.tryPromise({ try: () => digestOf(path), catch: (error) => refused('release', `${path} could not be read: ${String(error)}`) });

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
    const sha256 = yield* digested(path);
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
  readonly repo: string;
  readonly remote: string;
  readonly kept: string;
};

export const publishRelease = (
  gh: GitHubCli,
  notary: Notary,
  { cut, checkout, repo, remote, kept }: Publishing,
): Effect.Effect<Published, PublishRefused, FileSystem.FileSystem | Git> =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const git = yield* Git;
      const unreadable = unreadableIn('release');
      const cutStood = yield* cutStanding(cut);
      const { release } = cutStood.record;
      const tag = tagOf(release);

      const clone = yield* publishedClone(remote).pipe(
        Effect.mapError((trouble) =>
          refused('feed', trouble.detail, trouble.remote ? [`check access to ${repo}: gh auth status`, AGAIN] : [AGAIN]),
        ),
      );
      const published = clone.feed?.releases ?? [];
      const listed = published.find((one) => one.release === release);
      const replaced = listed === undefined ? `gh release delete ${tag} --repo ${repo} --cleanup-tag, then publish again` : RECUT;
      const newest = published.toSorted((a, b) => compareReleases(b.release, a.release))[0];
      if (listed === undefined && newest !== undefined && compareReleases(newest.release, release) >= 0) {
        return yield* refused(
          'version',
          `${newest.release} is published in ${repo} since ${release} was cut, and a release is published over older ones`,
          [RECUT],
        );
      }

      const { record, home } = yield* notarizedCut(notary, cut, cutStood);
      if (listed !== undefined) {
        const before = archivesOf(listed);
        const differs =
          Object.keys(before).length !== Object.keys(record.platforms).length ||
          Object.entries(record.platforms).some(
            ([platform, one]) => before[platform]?.sha256 !== one.sha256 || before[platform]?.size !== one.size,
          );
        if (differs) return yield* refused('feed', `the feed of ${repo} offers ${release} with other platform archives`, [replaced]);
      }
      const shipped: readonly Shipped[] = [
        ...Object.values(record.platforms).map((one) => ({
          path: join(home, one.archive),
          name: one.archive,
          size: one.size,
          sha256: one.sha256,
        })),
        ...(yield* Effect.forEach(Object.values(record.images), (name) =>
          Effect.gen(function* () {
            const path = join(home, name);
            const size = Number((yield* files.stat(path).pipe(Effect.mapError(unreadable(path)))).size);
            return { path, name, size, sha256: yield* digested(path) } satisfies Shipped;
          }),
        )),
      ];

      const sourceTag = yield* git
        .run(['tag', '--list', tag, '--format=%(objectname)'], { cwd: checkout })
        .pipe(Effect.mapError((failure) => refused('tag', failure.message, [AGAIN])));
      const standing = sourceTag.stdout.trim();
      if (standing !== '' && standing !== record.commit) {
        return yield* refused('tag', `${tag} in ${checkout} names ${standing}, and ${release} was cut from ${record.commit}`, [
          `git tag -d ${tag}, if it names nothing published`,
        ]);
      }

      const found = yield* viewed(gh, repo, tag, cut);
      if (found === null && listed !== undefined) {
        return yield* refused('release', `the feed of ${repo} offers ${release}, and ${repo} holds no GitHub Release ${tag}`, [
          `restore GitHub Release ${tag} in ${repo}, or take ${release} out of ${FEED_FILE} on main of ${repo}`,
        ]);
      }
      if (found === null) {
        yield* gh
          .run(['release', 'create', tag, '--repo', repo, '--draft', '--title', `Tagma ${release}`, '--notes', ''], cut)
          .pipe(Effect.mapError(ghFailed('release')));
      }
      const draft = found ?? (yield* viewed(gh, repo, tag, cut));
      if (draft === null) return yield* refused('release', `gh created the draft release ${tag} in ${repo} and does not find it`, [AGAIN]);
      const owed = shipped.filter((one) => fits(draft.assets, one) === undefined);
      if (owed.length > 0) {
        if (!draft.isDraft) {
          return yield* refused(
            'release',
            `${tag} is published in ${repo} without ${owed.map((one) => one.name).join(' and ')} as cut, and a published release keeps its files`,
            [replaced],
          );
        }
        yield* gh
          .run(['release', 'upload', tag, ...owed.map((one) => one.path), '--repo', repo, '--clobber'], cut, Duration.infinity)
          .pipe(Effect.mapError(ghFailed('upload')));
      }
      if (draft.isDraft) {
        yield* gh
          .run(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest'], cut)
          .pipe(Effect.mapError(ghFailed('release')));
      }
      const landed = owed.length === 0 && !draft.isDraft ? draft : yield* viewed(gh, repo, tag, cut);
      if (landed === null || landed.isDraft || shipped.some((one) => fits(landed.assets, one) === undefined)) {
        return yield* refused(
          'release',
          `${tag} in ${repo} does not stand published with ${shipped.map((one) => one.name).join(' and ')} as cut`,
          [AGAIN],
        );
      }

      if (standing === '') {
        yield* git.run(['tag', tag, record.commit], { cwd: checkout }).pipe(
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

      const address = (name: string): string => landed.assets.find((one) => one.name === name)!.url;
      const platforms = Object.fromEntries(Object.entries(record.platforms).map(([platform, one]) => [platform, address(one.archive)]));
      const images = Object.fromEntries(Object.entries(record.images).map(([platform, name]) => [platform, address(name)]));
      const answer = { release, page: landed.url, archive: platforms[LEGACY_PLATFORM]!, platforms, images, maps };
      if (listed !== undefined) return { ...answer, feed: null };

      const next: Feed = { releases: [feedEntry(record, address), ...published] };
      const feedPath = join(clone.work, FEED_FILE);
      yield* files.writeFileString(feedPath, `${encodeFeed(next)}\n`).pipe(Effect.mapError(unreadable(feedPath)));
      const pushed = (args: readonly string[], remotely = false, unblock: readonly string[] = [AGAIN]) =>
        clone.git(args, remotely).pipe(Effect.mapError((trouble) => refused('feed', trouble.detail, unblock)));
      yield* pushed(['add', FEED_FILE]);
      yield* pushed(['commit', '-q', '-m', `Release ${release}`]);
      yield* pushed(['push', '-q', remote, `HEAD:${FEED_BRANCH}`], true, [
        'bun run tagma:release publish — the release on GitHub stands, and publishing again writes only the feed',
      ]);
      return { ...answer, feed: (yield* pushed(['rev-parse', 'HEAD'])).trim() };
    }),
  );

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer);

type Told = (code: string, reason: string, unblock?: readonly string[]) => never;

const notaryOf = Effect.fnUntraced(function* (sourcePath: string, told: Told): Effect.fn.Return<Notary> {
  const signer = yield* Effect.result(releaseIdentity.pipe(Effect.provide(machine)));
  if (signer._tag === 'Failure') return told('signing-refused', signer.failure.detail, signer.failure.unblock);
  const team = developerTeam(signer.success);
  if (team === null) return told('signing-refused', `"${signer.success.name}" names no Developer ID team`);
  return yield* appleNotary({
    signing: { identity: signer.success.fingerprint, timestamp: true },
    team,
    assets: desktopAssets(sourcePath),
  }).pipe(Effect.provide(machine));
});

const NOTARIZE_USAGE = 'bun run tagma:release notarize [--out <dir>] [--json]';

export const notarizeCommand = Effect.fnUntraced(function* (sourcePath: string, given: readonly string[], developer: Channel) {
  let json = given.includes('--json');
  const told: Told = (code, reason, unblock = [NOTARIZE_USAGE]) => {
    if (json) console.log(JSON.stringify({ code, reason, unblock }));
    else console.error(refusalLines({ code, reason, unblock: [...unblock] }).join('\n'));
    process.exit(2);
  };
  const flags = flagsOf(given, told);
  json = flags.json;
  if (flags.rest.length > 0) told('usage', `${flags.rest.join(' ')} is not understood: notarizing takes the release that is cut`);
  const data = dataDirectory(developer, process.env);
  if (data === null) return told('no-home', 'HOME names no home directory, so where the release is cut is unknown');
  const named = flags.value('--out');
  const cut = named === undefined ? join(data, RELEASE_DIRECTORY) : resolve(named);
  const notary = yield* notaryOf(sourcePath, told);
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
    `Tagma ${record.release} is notarized by Apple and stapled; nothing is published`,
    ...Object.entries(record.platforms).flatMap(([platform, one]) => [
      `application ${platform} ${join(home, record.images[platform] ?? '')} — opens without a warning on a Mac of its kind`,
      `update archive ${platform} ${join(home, one.archive)}, sha256 ${one.sha256}`,
    ]),
    'bun run tagma:release publish — publishes it without sending it to Apple again',
  ])
    console.log(line);
});

export const publishCommand = Effect.fnUntraced(function* (sourcePath: string, given: readonly string[], developer: Channel) {
  const checkout = checkoutOf(sourcePath);
  let json = given.includes('--json');
  const told = (code: string, reason: string, unblock: readonly string[] = [USAGE]): never => {
    if (json) console.log(JSON.stringify({ code, reason, unblock }));
    else console.error(refusalLines({ code, reason, unblock: [...unblock] }).join('\n'));
    process.exit(2);
  };
  const flags = flagsOf(given, told);
  json = flags.json;
  if (flags.rest.length > 0) told('usage', `${flags.rest.join(' ')} is not understood: publishing takes the release that is cut`);
  const repo = flags.value('--repo') ?? FEED_REPOSITORY;
  if (!REPOSITORY.test(repo)) told('usage', `${repo} names no GitHub repository: owner/name`);
  const data = dataDirectory(developer, process.env);
  if (data === null) return told('no-home', 'HOME names no home directory, so where the release is cut is unknown');
  const named = flags.value('--out');
  const notary = yield* notaryOf(sourcePath, told);
  const outcome = yield* Effect.result(
    publishRelease(gitHubCli, notary, {
      cut: named === undefined ? join(data, RELEASE_DIRECTORY) : resolve(named),
      checkout,
      repo,
      remote: feedRemote(repo),
      kept: join(data, KEPT_MAPS),
    }).pipe(Effect.provide(machine)),
  );
  if (outcome._tag === 'Failure') {
    return told('publish-refused', `${outcome.failure.step}: ${outcome.failure.detail}`, outcome.failure.unblock);
  }
  const done = outcome.success;
  if (json) {
    console.log(JSON.stringify({ ...done, repo }, null, 2));
    return;
  }
  for (const line of [
    `Tagma ${done.release} published in ${repo} — ${done.page}`,
    ...Object.entries(done.platforms).flatMap(([platform, archive]) => [
      `application ${platform} ${done.images[platform] ?? 'missing'}`,
      `update archive ${platform} ${archive}`,
    ]),
    done.feed === null ? `the feed of ${repo} already offered ${done.release}` : `feed ${FEED_FILE} on main of ${repo} at ${done.feed}`,
    `tag ${tagOf(done.release)} in ${checkout}; source maps kept in ${done.maps}`,
  ])
    console.log(line);
});
