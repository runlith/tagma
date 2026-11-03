import { Effect } from 'effect';
import { Git } from '@runlith/git/Git';
import { compareReleases, type Feed, releaseOfTag } from '../installation/contract/wire/feed.js';
import type { PublishTrouble } from './descriptor.js';

export const checkoutTags = Effect.fn('installation.checkoutTags')(function* (
  checkout: string,
): Effect.fn.Return<readonly string[], PublishTrouble, Git> {
  const git = yield* Git;
  const answer = yield* git
    .run(['tag', '--list', 'v*'], { cwd: checkout })
    .pipe(Effect.mapError((failure): PublishTrouble => ({ detail: failure.message, unblock: [] })));
  if (answer.status !== 0) {
    return yield* Effect.fail<PublishTrouble>({ detail: `git tag --list exited ${answer.status}: ${answer.stderr.trim()}`, unblock: [] });
  }
  return answer.stdout
    .split('\n')
    .map((line) => releaseOfTag(line.trim()))
    .filter((release) => release !== null);
});

const known = (latest: Feed | null, tags: readonly string[]): readonly string[] => [
  ...tags,
  ...(latest?.releases.map((one) => one.release) ?? []),
];

const highestAmong = (numbers: readonly string[]): string | null =>
  numbers.reduce<string | null>((highest, one) => (highest === null || compareReleases(one, highest) > 0 ? one : highest), null);

export const highestOf = (latest: Feed | null, tags: readonly string[]): string | null => highestAmong(known(latest, tags));

export const precedingOf = (latest: Feed | null, tags: readonly string[], release: string): string | null =>
  highestAmong(known(latest, tags).filter((one) => compareReleases(one, release) < 0));
