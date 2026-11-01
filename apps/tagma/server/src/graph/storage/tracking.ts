import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { quietGit, runGit } from '../../platform/git/ownGit.js';
import type { BranchRelation, TrackedSides } from '../contract/service/exchange.js';

export const trackingRef = (tracking: string, branch: string): string => `${tracking}/${branch}`;

export const trackedLabel = (tracking: string, branch: string): string => `${tracking.replace(/^refs\/remotes\//, '')}/${branch}`;

export const readSides = Effect.fnUntraced(function* (git: Git['Service'], gitDir: string, tracking: string) {
  const out = yield* runGit(git, 'remote-sides', [
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
  quietGit(git, 'remote-base', ['--git-dir', gitDir, 'merge-base', one, other]);

export const relate = Effect.fnUntraced(function* (git: Git['Service'], gitDir: string, sides: TrackedSides) {
  const untracked: string[] = [];
  const ahead: string[] = [];
  const behind: { readonly branch: string; readonly local: string; readonly tracked: string }[] = [];
  const diverged: string[] = [];
  for (const [branch, local] of sides.local) {
    const tracked = sides.tracked.get(branch);
    if (tracked === undefined) {
      untracked.push(branch);
      continue;
    }
    if (tracked === local) continue;
    const base = yield* baseOf(git, gitDir, local, tracked);
    if (base === tracked) ahead.push(branch);
    else if (base === local) behind.push({ branch, local, tracked });
    else if (base !== null) diverged.push(branch);
  }
  return { untracked, ahead, behind, diverged } satisfies BranchRelation;
});

export const forwardBranch = (git: Git['Service'], gitDir: string, branch: string, to: string, from: string) =>
  Effect.asVoid(runGit(git, 'remote-forward', ['--git-dir', gitDir, 'update-ref', `refs/heads/${branch}`, to, from]));
