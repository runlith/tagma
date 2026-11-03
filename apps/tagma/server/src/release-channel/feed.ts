import { Effect, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import type { NextIssue } from '../installation/contract/wire/next.js';
import {
  compareReleases,
  type Feed,
  type FeedRelease,
  feedSchema,
  isRelease,
  newestOf,
  type ReleaseArchive,
} from '../installation/contract/wire/feed.js';
import type { InstallationPlatform } from '../installation/contract/wire/manifest.js';

const decodeFeed = Schema.decodeUnknownResult(Schema.fromJsonString(feedSchema));

export const newerThan = (feed: Feed, running: string): readonly FeedRelease[] =>
  feed.releases
    .filter((one) => !isRelease(running) || compareReleases(one.release, running) > 0)
    .toSorted((a, b) => compareReleases(b.release, a.release));

export type ReleaseChoice = { readonly release: ReleaseArchive | null; readonly issue: NextIssue | null };

export const releaseFor = (feed: Feed, running: string, platform: InstallationPlatform): ReleaseChoice => {
  const newest = newestOf(feed);
  if (isRelease(running) && compareReleases(newest.release, running) <= 0) return { release: null, issue: null };
  const key = `${platform.os}-${platform.arch}`;
  const archive = newest.platforms[key];
  return archive === undefined
    ? {
        release: null,
        issue: {
          code: 'platform-unavailable',
          reason: `release ${newest.release} has no archive for this machine's platform ${key}`,
          unblock: [`tagma status — check again when a release with an archive for ${key} is published`],
        },
      }
    : {
        release: { release: newest.release, platform, irreversible: newest.irreversible, changes: newest.changes, ...archive },
        issue: null,
      };
};

export const crossesNoWayBack = (feed: Feed, below: string, upTo: string): boolean =>
  newestOf(feed).changes.some(
    (one) =>
      !isRelease(one.release) ||
      ((!isRelease(below) || compareReleases(one.release, below) > 0) && (!isRelease(upTo) || compareReleases(one.release, upTo) <= 0)),
  );

const unreachable = (url: string, detail: string): NextIssue => ({
  code: 'offline',
  reason: `the release feed at ${url} could not be reached: ${detail}`,
  unblock: ['tagma status — ask again once this machine is online'],
});

const unreadable = (url: string, detail: string): NextIssue => ({
  code: 'source-unreadable',
  reason: `the release feed at ${url} does not read as a feed: ${detail}`,
  unblock: ['tagma status — ask again later; the feed is written by whoever publishes releases'],
});

export const readFeed = Effect.fn('release.readFeed')(function* (client: HttpClient.HttpClient, url: string) {
  const response = yield* client
    .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson))
    .pipe(Effect.mapError((failure) => unreachable(url, failure.message)));
  if (response.status === 404) return yield* Effect.fail(unreadable(url, 'it answered 404: no published release carries a feed there'));
  if (response.status < 200 || response.status >= 300) return yield* Effect.fail(unreadable(url, `it answered ${response.status}`));
  const text = yield* response.text.pipe(Effect.mapError((failure) => unreachable(url, failure.message)));
  const decoded = decodeFeed(text);
  if (decoded._tag === 'Failure') return yield* Effect.fail(unreadable(url, decoded.failure.message));
  return decoded.success;
});
