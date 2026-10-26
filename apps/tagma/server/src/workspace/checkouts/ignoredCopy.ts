import { Effect, type FileSystem, type Path } from 'effect';
import { worktreesOf } from '@runlith/git/worktree';
import type { Git } from '@runlith/git/Git';

export const copyIgnored = Effect.fn('WorktreeSetups.copyIgnored')(function* (
  git: Git['Service'],
  files: FileSystem.FileSystem,
  paths: Path.Path,
  from: string,
  tree: string,
  patterns: readonly string[],
): Effect.fn.Return<number, string> {
  if (patterns.length === 0) return 0;
  const checkouts = yield* worktreesOf(git, from).pipe(
    Effect.mapError((failure) => `git could not list the checkouts of ${from}'s repository: ${failure.message}`),
  );
  const main = checkouts.find((checkout) => !checkout.bare)?.path;
  if (main === undefined) return yield* Effect.fail(`${from}'s repository has no main checkout to copy from.`);
  const listed = yield* git
    .run([
      '-C',
      main,
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      ...patterns.map((pattern) => `:(glob)${pattern}`),
    ])
    .pipe(Effect.mapError((failure) => `git could not list the ignored files of ${main}: ${failure.message}`));
  if (listed.status !== 0) return yield* Effect.fail(`git could not list the ignored files of ${main}: ${listed.stderr.trim()}`);
  let copied = 0;
  for (const relative of listed.stdout.split('\0').filter((entry) => entry !== '')) {
    const target = paths.join(tree, relative);
    const done = yield* Effect.gen(function* () {
      if (yield* files.exists(target)) return false;
      yield* files.makeDirectory(paths.dirname(target), { recursive: true });
      yield* files.copyFile(paths.join(main, relative), target);
      return true;
    }).pipe(Effect.mapError((failure) => `${relative} could not be copied: ${failure.message}`));
    if (done) copied += 1;
  }
  return copied;
});
