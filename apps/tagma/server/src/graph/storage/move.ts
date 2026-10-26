import { dirname, join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ShadowGit } from '../tree/shadow.js';
import { type OwnGitFailed, runGit } from '../../platform/git/ownGit.js';
import { unmergedPaths } from '../../platform/git/unmerged.js';
import { WORKFLOWS_DIRECTORY } from '../contract/wire/storage.js';
import type { StorageLayout } from './layout.js';
import type { Git } from '@runlith/git/Git';
import { treeBranch, type TreeCaptureFailed } from '../tree/batch.js';

export const treeContent = Effect.fn('Graph.storageContent')(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const names = yield* files.readDirectory(root).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed([])));
  return names.filter((name) => name !== '.git' && name !== WORKFLOWS_DIRECTORY);
});

const travel = Effect.fn('Graph.storageTravel')(function* (source: string, target: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.remove(target, { recursive: true, force: true });
  yield* files.makeDirectory(dirname(target), { recursive: true });
  yield* files.rename(source, target).pipe(
    Effect.catchIf(
      (error) => typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause && error.cause.code === 'EXDEV',
      () => Effect.andThen(files.copy(source, target, { overwrite: true }), files.remove(source, { recursive: true, force: true })),
    ),
  );
});

const prepare = Effect.fnUntraced(function* (git: Git['Service'], to: StorageLayout, checkout: string, origin: string | null) {
  if (to.mode === 'team') {
    yield* (yield* FileSystem.FileSystem).makeDirectory(to.treeRoot, { recursive: true });
    return null;
  }
  const shadow = yield* ShadowGit.open(to.gitDir, git, origin);
  const standing = yield* treeBranch(checkout);
  if ('held' in standing && standing.held !== 'no-repository') {
    return yield* new GateRefusal('detached-checkout', `${checkout} stands on a detached HEAD, not a branch`, [
      'git switch <branch> in the checkout — a stealth tree stands on the branch its checkout does',
    ]);
  }
  yield* shadow.attach(to.treeRoot, 'ref' in standing ? standing.ref.slice('refs/heads/'.length) : 'main');
  return shadow;
});

const retire = Effect.fn('Graph.storageRetire')(function* (git: Git['Service'], from: StorageLayout) {
  const files = yield* FileSystem.FileSystem;
  if (from.mode === 'stealth') {
    yield* files.remove(from.treeRoot, { recursive: true, force: true });
    yield* runGit(git, 'worktree-prune', ['--git-dir', from.gitDir, 'worktree', 'prune']);
    return;
  }
  for (const name of yield* treeContent(from.treeRoot)) yield* files.remove(join(from.treeRoot, name), { recursive: true, force: true });
});

export const moveStorage = Effect.fnUntraced(function* ({
  git,
  from,
  to,
  checkout,
  origin,
}: {
  readonly git: Git['Service'];
  readonly from: StorageLayout;
  readonly to: StorageLayout;
  readonly checkout: string;
  readonly origin: string | null;
}): Effect.fn.Return<
  void,
  | GateRefusal<'detached-checkout' | 'tree-missing' | 'target-holds-tree' | 'tree-mid-merge'>
  | OwnGitFailed
  | PlatformError
  | TreeCaptureFailed,
  FileSystem.FileSystem
> {
  const files = yield* FileSystem.FileSystem;
  const source = yield* treeContent(from.treeRoot);
  if (source.length === 0) {
    return yield* new GateRefusal('tree-missing', `no tree stands at ${from.treeRoot}`, [
      'restore the tree from its git or a backup, then move it',
    ]);
  }
  if ((yield* treeContent(to.treeRoot)).length > 0) {
    return yield* new GateRefusal('target-holds-tree', `${to.treeRoot} already holds a tree`, [
      `empty ${to.treeRoot} — a move never writes over a graph standing at its target`,
    ]);
  }
  const unmerged = yield* unmergedPaths(git, from.treeRoot);
  if (unmerged.length > 0) {
    return yield* new GateRefusal('tree-mid-merge', `the tree stands mid-merge with ${unmerged.length} unmerged path(s)`, [
      'tagma files resolve — conclude the merge, then move',
    ]);
  }
  const shadow = yield* prepare(git, to, checkout, origin);
  for (const name of yield* treeContent(to.treeRoot)) yield* files.remove(join(to.treeRoot, name), { recursive: true, force: true });
  for (const name of source) yield* travel(join(from.treeRoot, name), join(to.treeRoot, name));
  yield* retire(git, from);
  if (shadow !== null) yield* shadow.commitAct(to.treeRoot, `storage moved to ${to.mode}`);
});
