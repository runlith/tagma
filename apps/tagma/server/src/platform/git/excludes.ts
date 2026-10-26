import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { runEnded } from '@runlith/git/repository';
import { readingFailed } from './ownGit.js';

export const excludesFileAt = Effect.fn('git.excludesFile')(function* (git: Git['Service'], root: string) {
  const ended = yield* runEnded(git, root, ['config', '--path', '--get', 'core.excludesFile'], undefined, [1]).pipe(
    Effect.mapError((failure) => readingFailed('excludes', failure)),
  );
  const configured = ended.stdout.replace(/\r?\n$/, '');
  if (ended.status === 0) return configured === '' ? null : resolve(root, configured);
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== '') return join(xdg, 'git', 'ignore');
  const home = homedir();
  return home === '' ? null : join(home, '.config', 'git', 'ignore');
});
