import type { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import { generatedAnswer, generatedQuestion } from './generatedAttribute.js';
import { type OwnGitFailed, runGit } from './ownGit.js';

export const generatedAmong = Effect.fn('git.generatedAmong')(function* (
  git: Git['Service'],
  root: string,
  paths: readonly string[],
  source: string | null,
): Effect.fn.Return<ReadonlySet<string>, OwnGitFailed> {
  if (paths.length === 0) return new Set<string>();
  const { args, stdin } = generatedQuestion(paths, source);
  return generatedAnswer(yield* runGit(git, 'generated-paths', ['-C', root, ...args], { stdin }));
});
