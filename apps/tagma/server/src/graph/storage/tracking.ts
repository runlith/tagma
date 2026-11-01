import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { quietGit, runGit } from '../../platform/git/ownGit.js';
import type { TrackedSides } from '../contract/service/exchange.js';

export const trackingRef = (tracking: string, branch: string): string => `${tracking}/${branch}`;

export const trackedLabel = (tracking: string, branch: string): string => `${tracking.replace(/^refs\/remotes\//, '')}/${branch}`;

export const readSides = Effect.fnUntraced(function* (git: Git['Service'], gitDir: string, tracking: string) {
  const out = yield* runGit(git, 'tracked-sides', [
    '--git-dir',
    gitDir,
    'for-each-ref',
    '--format=%(refname)%00%(objectname)',
    'refs/heads',
    tracking,
  ]);
  const local = new Map<string, string>();
  const tracked = new Map<string, string>();
  for (const line of out === '' ? [] : out.split('\n')) {
    const [ref = '', tip = ''] = line.split('\0');
    if (ref.startsWith('refs/heads/')) local.set(ref.slice('refs/heads/'.length), tip);
    else if (ref.startsWith(`${tracking}/`) && ref !== `${tracking}/HEAD`) tracked.set(ref.slice(tracking.length + 1), tip);
  }
  return { local, tracked } satisfies TrackedSides;
});

export const baseOf = (git: Git['Service'], gitDir: string, one: string, other: string) =>
  quietGit(git, 'tracked-base', ['--git-dir', gitDir, 'merge-base', one, other]);

export const forwardBranch = (git: Git['Service'], gitDir: string, branch: string, to: string, from: string) =>
  Effect.asVoid(runGit(git, 'tracked-forward', ['--git-dir', gitDir, 'update-ref', `refs/heads/${branch}`, to, from]));
