import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer } from 'effect';
import { Git, gitLayer } from '@runlith/git/Git';
import { run, runEnded } from '@runlith/git/repository';
import { excludesFileAt } from '../git/excludes.js';
import { ledgeredSpawner } from '../git/ledgered.js';
import { ownGitLayer } from '../git/ownGit.js';

const HOST = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const GIT = ownGitLayer(gitLayer.pipe(Layer.provide(ledgeredSpawner('git').pipe(Layer.provide(HOST)))));

const depth = (path: string): number => path.split('/').length;

export const byDepth = (left: string, right: string): number => depth(left) - depth(right) || left.localeCompare(right);

const checked = Effect.fnUntraced(function* (git: Git['Service'], tree: string, paths: readonly string[]) {
  if (paths.length === 0) return [];
  const ended = yield* runEnded(git, tree, ['check-ignore', '--stdin', '-z'], undefined, [1], { stdin: `${paths.join('\0')}\0` });
  return ended.stdout.split('\0').filter((entry) => entry !== '');
});

export const excludesFile = (tree: string) =>
  Effect.provide(
    Effect.flatMap(Git, (git) => excludesFileAt(git, tree)),
    GIT,
  );

export const ignoredAmong = Effect.fn('watch.ignoredAmong')(
  function* (tree: string, paths: readonly string[]) {
    return yield* checked(yield* Git, tree, paths);
  },
  (effect) => Effect.provide(effect, GIT),
);

export const ignoredUnder = Effect.fn('watch.ignored')(
  function* (tree: string) {
    const git = yield* Git;
    const listed = yield* run(git, tree, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], undefined);
    const directories = listed
      .split('\0')
      .filter((entry) => entry.endsWith('/'))
      .map((entry) => entry.slice(0, -1));
    return (yield* checked(git, tree, directories)).sort(byDepth);
  },
  (effect) => Effect.provide(effect, GIT),
);
