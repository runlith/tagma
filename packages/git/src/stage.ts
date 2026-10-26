import { Array as Arr, Effect } from 'effect';
import type { Git } from './Git.js';
import { run, literal, type GitAnswerInvalid, type GitRefused, type GitUnreadable } from './repository.js';

export type ActedPaths = Arr.NonEmptyReadonlyArray<string>;

export type Discarded = { readonly tracked?: readonly string[]; readonly untracked?: readonly string[] };

const fed = (paths: readonly string[]): string => paths.map(literal).join('\0');
const FROM_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul', '--'];

export type ActOptions = { readonly capture?: number };

export const stageAt = Effect.fn('Git.stage')(function* (
  git: Git['Service'],
  dir: string,
  paths: ActedPaths,
  options: ActOptions = {},
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  yield* run(git, dir, ['add', '-A', ...FROM_STDIN], options.capture, fed(paths));
  return paths;
});

export const unstageAt = Effect.fn('Git.unstage')(function* (
  git: Git['Service'],
  dir: string,
  paths: ActedPaths,
  options: ActOptions = {},
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  yield* run(git, dir, ['reset', '-q', ...FROM_STDIN], options.capture, fed(paths));
  return paths;
});

export const discardAt = Effect.fn('Git.discard')(function* (
  git: Git['Service'],
  dir: string,
  paths: Discarded,
  options: ActOptions = {},
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const tracked = paths.tracked ?? [];
  const untracked = paths.untracked ?? [];
  if (tracked.length > 0) {
    yield* run(git, dir, ['checkout', ...FROM_STDIN], options.capture, fed(tracked));
  }
  if (untracked.length > 0) {
    yield* run(git, dir, ['clean', '-f', '--', ...untracked.map(literal)], options.capture);
  }
  return [...tracked, ...untracked];
});
