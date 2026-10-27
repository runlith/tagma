import { join } from 'node:path';
import { Effect, FileSystem, Schema, type Scope } from 'effect';
import { Git } from '@runlith/git/Git';
import type { GitHubCli, ProgramFailure } from '@runlith/github/GitHubCli';
import { compareReleases, type Feed, FEED_FILE, feedSchema, releaseOfTag } from '../contract/wire/feed.js';

const NOT_FOUND = /release not found/u;
const ABSENT_REF = /\(HTTP 404\)/u;

export type PublishedTrouble = { readonly detail: string; readonly unblock: readonly string[] };

export type Issued = { readonly latest: Feed | null; readonly numbers: readonly string[] };

export const ghTrouble =
  (repo: string) =>
  (failure: ProgramFailure): PublishedTrouble =>
    failure._tag === 'ProgramUnavailable'
      ? { detail: `gh: ${failure.detail}`, unblock: ['install the GitHub CLI (https://cli.github.com), then gh auth login'] }
      : { detail: `gh: ${failure.detail}`, unblock: [`gh auth status — gh signs in to github.com and reaches ${repo}`] };

const absentAs = <A>(absent: RegExp, effect: Effect.Effect<A, ProgramFailure>): Effect.Effect<A | null, ProgramFailure> =>
  effect.pipe(
    Effect.catchTag('ProgramFailed', (failure) =>
      failure.phase === 'exit' && absent.test(failure.stderr ?? '') ? Effect.succeed(null) : Effect.fail(failure),
    ),
  );

const Latest = Schema.Struct({ tagName: Schema.String, assets: Schema.Array(Schema.Struct({ name: Schema.String })) });
const decodeLatest = Schema.decodeUnknownResult(Schema.fromJsonString(Latest));
const decodeFeed = Schema.decodeUnknownResult(Schema.fromJsonString(feedSchema));

export const releaseFeed = Effect.fn('installation.releaseFeed')(function* (
  gh: GitHubCli,
  repo: string,
  tag: string,
  cwd: string,
): Effect.fn.Return<Feed, PublishedTrouble, FileSystem.FileSystem | Scope.Scope> {
  const files = yield* FileSystem.FileSystem;
  const into = yield* files
    .makeTempDirectoryScoped({ prefix: 'tagma-feed-' })
    .pipe(Effect.mapError((error) => ({ detail: `a directory for the feed could not be made: ${error.reason._tag}`, unblock: [] })));
  yield* gh
    .run(['release', 'download', tag, '--repo', repo, '--pattern', FEED_FILE, '--dir', into, '--clobber'], cwd)
    .pipe(Effect.mapError(ghTrouble(repo)));
  const path = join(into, FEED_FILE);
  const text = yield* files
    .readFileString(path)
    .pipe(Effect.mapError((error) => ({ detail: `${path} could not be read: ${error.reason._tag}`, unblock: [] })));
  const decoded = decodeFeed(text);
  if (decoded._tag === 'Failure') {
    return yield* Effect.fail({
      detail: `${FEED_FILE} of ${tag} in ${repo} does not read as a feed: ${decoded.failure.message}`,
      unblock: [`gh release edit ${tag} --repo ${repo} --prerelease — the release before it becomes Latest again`],
    });
  }
  return decoded.success;
});

export const latestFeed = Effect.fn('installation.latestFeed')(function* (
  gh: GitHubCli,
  repo: string,
  cwd: string,
): Effect.fn.Return<Feed | null, PublishedTrouble, FileSystem.FileSystem | Scope.Scope> {
  const viewed = yield* absentAs(NOT_FOUND, gh.run(['release', 'view', '--repo', repo, '--json', 'tagName,assets'], cwd)).pipe(
    Effect.mapError(ghTrouble(repo)),
  );
  if (viewed === null) return null;
  const read = decodeLatest(viewed.stdout);
  if (read._tag === 'Failure') {
    return yield* Effect.fail({ detail: `gh release view answered what does not read as a release: ${read.failure.message}`, unblock: [] });
  }
  const { tagName, assets } = read.success;
  if (!assets.some((asset) => asset.name === FEED_FILE)) {
    return yield* Effect.fail({
      detail: `${tagName}, the Latest release of ${repo}, carries no ${FEED_FILE}, so the releases published before it cannot be read`,
      unblock: [`gh release edit ${tagName} --repo ${repo} --prerelease — the release before it becomes Latest again`],
    });
  }
  return yield* releaseFeed(gh, repo, tagName, cwd);
});

export const publishedNumbers = (gh: GitHubCli, repo: string, cwd: string): Effect.Effect<readonly string[], PublishedTrouble> =>
  gh.run(['api', '--paginate', `repos/${repo}/releases?per_page=100`, '--jq', '.[] | select(.draft | not) | .tag_name'], cwd).pipe(
    Effect.mapError(ghTrouble(repo)),
    Effect.map((ended) =>
      ended.stdout
        .split('\n')
        .map((line) => releaseOfTag(line.trim()))
        .filter((release) => release !== null),
    ),
    Effect.withSpan('installation.publishedNumbers'),
  );

export const issuedReleases = Effect.fnUntraced(function* (gh: GitHubCli, repo: string, cwd: string) {
  const [latest, numbers] = yield* Effect.all([latestFeed(gh, repo, cwd), publishedNumbers(gh, repo, cwd)], { concurrency: 2 });
  return { latest, numbers } satisfies Issued;
});

export const remoteTag = Effect.fn('installation.remoteTag')(function* (
  gh: GitHubCli,
  repo: string,
  tag: string,
  cwd: string,
): Effect.fn.Return<string | null, PublishedTrouble> {
  const named = yield* absentAs(
    ABSENT_REF,
    gh.run(['api', `repos/${repo}/git/ref/tags/${tag}`, '--jq', '.object.type + " " + .object.sha'], cwd),
  ).pipe(Effect.mapError(ghTrouble(repo)));
  if (named === null) return null;
  const [kind, sha = ''] = named.stdout.trim().split(' ');
  if (kind !== 'tag') return sha;
  const peeled = yield* gh.run(['api', `repos/${repo}/git/tags/${sha}`, '--jq', '.object.sha'], cwd).pipe(Effect.mapError(ghTrouble(repo)));
  return peeled.stdout.trim();
});

export const checkoutTags = Effect.fn('installation.checkoutTags')(function* (
  checkout: string,
): Effect.fn.Return<readonly string[], PublishedTrouble, Git> {
  const git = yield* Git;
  const answer = yield* git
    .run(['tag', '--list', 'v*'], { cwd: checkout })
    .pipe(Effect.mapError((failure): PublishedTrouble => ({ detail: failure.message, unblock: [] })));
  if (answer.status !== 0) {
    return yield* Effect.fail<PublishedTrouble>({ detail: `git tag --list exited ${answer.status}: ${answer.stderr.trim()}`, unblock: [] });
  }
  return answer.stdout
    .split('\n')
    .map((line) => releaseOfTag(line.trim()))
    .filter((release) => release !== null);
});

export const highestOf = (issued: Issued, tags: readonly string[]): string | null =>
  [...issued.numbers, ...tags, ...(issued.latest?.releases.map((one) => one.release) ?? [])].reduce<string | null>(
    (highest, one) => (highest === null || compareReleases(one, highest) > 0 ? one : highest),
    null,
  );
