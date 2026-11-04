import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { GitUnavailable, type Git } from './Git.js';
import {
  commandFor,
  type GitAnswerInvalid,
  type GitRefused,
  GitUnreadable,
  type Head,
  printedCommit,
  run,
  runEnded,
  unreadableBy,
} from './repository.js';

export type Worktree = {
  readonly path: string;
  readonly head: Head | null;
  readonly bare: boolean;
  readonly locked: string | null;
  readonly prunable: string | null;
};

export const worktreesOf = Effect.fn('Git.worktrees')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly Worktree[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const command = ['worktree', 'list', '--porcelain', '-z'];
  const listing = yield* run(git, dir, command, options.capture);
  const rows: Worktree[] = [];
  for (const record of listing.split('\0\0')) {
    if (record === '') continue;
    const worktree = worktreeIn(record);
    if (worktree === null) {
      return yield* new GitUnreadable({
        command: commandFor(dir, command),
        reason: 'worktree list named no worktree in a record',
      });
    }
    rows.push(worktree);
  }
  return yield* withMainTree(git, dir, rows);
});

const withMainTree = Effect.fnUntraced(function* (git: Git['Service'], dir: string, rows: readonly Worktree[]) {
  const [main] = rows;
  if (main === undefined || main.bare || existsSync(join(main.path, '.git'))) return rows;
  const configured = (yield* runEnded(
    git,
    dir,
    ['config', '--file', join(main.path, 'config'), '--get', 'core.worktree'],
    undefined,
    [1],
  )).stdout.trim();
  if (configured === '') return rows;
  return [{ ...main, path: resolve(main.path, configured) }, ...rows.slice(1)];
});

const WORKTREE = 'worktree ';
const HEAD = 'HEAD ';
const BRANCH = 'branch ';
const LOCKED = 'locked';
const PRUNABLE = 'prunable';

function worktreeIn(record: string): Worktree | null {
  let path: string | null = null;
  let ref: string | null = null;
  let commit: string | null = null;
  let bare = false;
  let locked: string | null = null;
  let prunable: string | null = null;
  for (const attribute of record.split('\0')) {
    if (attribute.startsWith(WORKTREE)) path = attribute.slice(WORKTREE.length);
    else if (attribute.startsWith(HEAD)) commit = printedCommit(attribute.slice(HEAD.length));
    else if (attribute.startsWith(BRANCH)) ref = attribute.slice(BRANCH.length);
    else if (attribute === 'bare') bare = true;
    else if (attribute === LOCKED) locked = '';
    else if (attribute.startsWith(`${LOCKED} `)) locked = attribute.slice(LOCKED.length + 1);
    else if (attribute === PRUNABLE) prunable = '';
    else if (attribute.startsWith(`${PRUNABLE} `)) prunable = attribute.slice(PRUNABLE.length + 1);
  }
  if (path === null || path === '' || ref === '') return null;
  return { path, head: bare ? null : { ref, commit }, bare, locked, prunable };
}

export type WorktreePlan =
  | { readonly mode: 'new-branch'; readonly path: string; readonly branch: string; readonly start: string }
  | { readonly mode: 'existing-branch'; readonly path: string; readonly branch: string }
  | { readonly mode: 'detached'; readonly path: string; readonly commit: string };

export type WorktreeCreation = {
  readonly command: readonly string[];
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly overflow: boolean;
  readonly messageOverflow: boolean;
};

export const CREATION_CAPTURE = 65536;

export const worktreeCommand = (dir: string, plan: WorktreePlan): readonly string[] => argv(dir, plan);

const argv = (dir: string, plan: WorktreePlan): readonly string[] => {
  const add = ['-C', dir, 'worktree', 'add'];
  if (plan.mode === 'new-branch') return [...add, '-b', plan.branch, '--end-of-options', plan.path, plan.start];
  if (plan.mode === 'existing-branch') return [...add, '--end-of-options', plan.path, plan.branch];
  return [...add, '--detach', '--end-of-options', plan.path, plan.commit];
};

const NO_LAZY_FETCH = { GIT_NO_LAZY_FETCH: '1' } as const;

export const addWorktree = Effect.fn('Git.addWorktree')(function* (
  git: Git['Service'],
  dir: string,
  plan: WorktreePlan,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<WorktreeCreation, GitUnreadable | GitUnavailable> {
  const command = argv(dir, plan);
  const answer = yield* git
    .run(command, { capture: options.capture ?? CREATION_CAPTURE, env: NO_LAZY_FETCH, extendEnv: true })
    .pipe(Effect.mapError((failure) => (failure._tag === 'GitUnavailable' ? failure : unreadableBy(command, failure))));
  return {
    command,
    status: answer.status,
    stdout: answer.stdout,
    stderr: answer.stderr.trim(),
    overflow: answer.overflow,
    messageOverflow: answer.messageOverflow,
  };
});

export const removeWorktreeAt = Effect.fn('Git.removeWorktree')(function* (
  git: Git['Service'],
  dir: string,
  path: string,
  options: { readonly capture?: number; readonly force?: boolean } = {},
): Effect.fn.Return<void, GitUnreadable | GitRefused | GitAnswerInvalid> {
  yield* run(
    git,
    dir,
    ['worktree', 'remove', ...(options.force === true ? ['--force', '--force'] : []), '--end-of-options', path],
    options.capture,
  );
});

export const deleteBranchAt = Effect.fn('Git.deleteBranch')(function* (
  git: Git['Service'],
  dir: string,
  branch: string,
  options: { readonly capture?: number; readonly force?: boolean } = {},
): Effect.fn.Return<void, GitUnreadable | GitRefused | GitAnswerInvalid> {
  yield* run(git, dir, ['branch', options.force === true ? '-D' : '-d', '--end-of-options', branch], options.capture);
});

export const renameBranchAt = Effect.fn('Git.renameBranch')(function* (
  git: Git['Service'],
  dir: string,
  from: string,
  to: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<void, GitUnreadable | GitRefused | GitAnswerInvalid> {
  yield* run(git, dir, ['branch', '-m', '--end-of-options', from, to], options.capture);
});
