import { join } from 'node:path';
import { Effect, FileSystem, Schema, type Scope } from 'effect';
import { Git } from '@runlith/git/Git';
import { type Feed, feedSchema } from '../contract/wire/feed.js';

export const FEED_FILE = 'feed.json';
export const FEED_REPOSITORY = 'runlith/tagma';
export const FEED_BRANCH = 'refs/heads/main';
export const feedRemote = (repo: string): string => `https://github.com/${repo}.git`;

const CREDENTIAL = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
const ABSENT = /repository not found|not found/iu;

const decodeFeed = Schema.decodeUnknownResult(Schema.fromJsonString(feedSchema));

export type PublishedTrouble = { readonly detail: string; readonly remote: boolean };

export type Clone = {
  readonly work: string;
  readonly feed: Feed | null;
  readonly git: (args: readonly string[], remote?: boolean) => Effect.Effect<string, PublishedTrouble>;
};

export const publishedClone = Effect.fnUntraced(function* (
  remote: string,
): Effect.fn.Return<Clone, PublishedTrouble, FileSystem.FileSystem | Git | Scope.Scope> {
  const files = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const work = yield* files
    .makeTempDirectoryScoped({ prefix: 'tagma-feed-' })
    .pipe(Effect.mapError((error) => ({ detail: `a directory for the feed could not be made: ${error.reason._tag}`, remote: false })));
  const run = (args: readonly string[], remotely = false) =>
    git.run(remotely ? [...CREDENTIAL, ...args] : args, { cwd: work, env: { GIT_TERMINAL_PROMPT: '0' }, extendEnv: true }).pipe(
      Effect.mapError((failure) => ({ detail: failure.message, remote: remotely })),
      Effect.flatMap((answer) =>
        answer.status === 0
          ? Effect.succeed(answer.stdout)
          : Effect.fail({ detail: `git ${args.join(' ')} exited ${answer.status}: ${answer.stderr.trim()}`, remote: remotely }),
      ),
    );
  yield* run(['init', '-q']);
  const asked = yield* git
    .run([...CREDENTIAL, 'ls-remote', remote, FEED_BRANCH], { cwd: work, env: { GIT_TERMINAL_PROMPT: '0' }, extendEnv: true })
    .pipe(Effect.mapError((failure) => ({ detail: failure.message, remote: true })));
  const absent = asked.status !== 0 && ABSENT.test(asked.stderr);
  if (asked.status !== 0 && !absent) {
    return yield* Effect.fail({ detail: `git ls-remote ${remote} exited ${asked.status}: ${asked.stderr.trim()}`, remote: true });
  }
  if (absent || asked.stdout.trim() === '') return { work, feed: null, git: run };
  yield* run(['fetch', '-q', '--depth', '1', remote, FEED_BRANCH], true);
  yield* run(['checkout', '-q', 'FETCH_HEAD']);
  const path = join(work, FEED_FILE);
  const present = yield* files.exists(path).pipe(Effect.mapError(() => ({ detail: `${path} could not be read`, remote: false })));
  if (!present) return { work, feed: null, git: run };
  const text = yield* files.readFileString(path).pipe(Effect.mapError(() => ({ detail: `${path} could not be read`, remote: false })));
  const decoded = decodeFeed(text);
  if (decoded._tag === 'Failure')
    return yield* Effect.fail({ detail: `${FEED_FILE} on main does not read as a feed: ${decoded.failure.message}`, remote: false });
  return { work, feed: decoded.success, git: run };
});
