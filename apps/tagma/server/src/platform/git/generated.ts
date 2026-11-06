import type { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import { type OwnGitFailed, runGit } from './ownGit.js';

export const GENERATED_ATTRIBUTE = 'linguist-generated';

export const markedGenerated = (value: string | undefined): boolean => value === 'set' || value === 'true';

export const generatedAmong = Effect.fn('git.generatedAmong')(function* (
  git: Git['Service'],
  root: string,
  paths: readonly string[],
  source: string | null,
): Effect.fn.Return<ReadonlySet<string>, OwnGitFailed> {
  const generated = new Set<string>();
  if (paths.length === 0) return generated;
  const answer = yield* runGit(
    git,
    'generated-paths',
    ['-C', root, 'check-attr', '-z', '--stdin', ...(source === null ? [] : ['--source', source]), GENERATED_ATTRIBUTE],
    { stdin: paths.map((path) => `${path}\0`).join('') },
  );
  const fields = answer.split('\0');
  for (let at = 0; at + 2 < fields.length; at += 3) if (markedGenerated(fields[at + 2])) generated.add(fields[at] as string);
  return generated;
});
