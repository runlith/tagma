import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ShadowGit } from '../tree/shadow.js';
import { type OwnGitFailed, runGit } from '../../platform/git/ownGit.js';
import { unmergedPaths } from '../../platform/git/unmerged.js';
import { WORKFLOWS_DIRECTORY } from '../contract/wire/storage.js';
import type { LayerPlace, StorageLayout } from './layout.js';
import type { Git } from '@runlith/git/Git';
import { treeBranch, type TreeCaptureFailed } from '../tree/batch.js';
import {
  type BlockTreeUnreadable,
  readBlockTree,
  type RenderedTree,
  renderBlockTree,
  renderForest,
  type ScannedBlock,
  visitForest,
} from '../tree/layout.js';

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

const branchOf = Effect.fnUntraced(function* (checkout: string) {
  const standing = yield* treeBranch(checkout);
  if ('held' in standing && standing.held !== 'no-repository') {
    return yield* new GateRefusal('detached-checkout', `${checkout} stands on a detached HEAD, not a branch`, [
      'git switch <branch> in the checkout — a stealth tree stands on the branch its checkout does',
    ]);
  }
  return 'ref' in standing ? standing.ref.slice('refs/heads/'.length) : 'main';
});

const prepare = Effect.fnUntraced(function* (git: Git['Service'], to: StorageLayout, checkout: string, origin: string | null) {
  if (to.mode === 'team') {
    yield* (yield* FileSystem.FileSystem).makeDirectory(to.treeRoot, { recursive: true });
    return null;
  }
  const shadow = yield* ShadowGit.open(to.gitDir, git, origin);
  yield* shadow.attach(to.treeRoot, yield* branchOf(checkout));
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

const pruneEmpty = Effect.fnUntraced(function* (dir: string): Effect.fn.Return<boolean, PlatformError, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  let empty = true;
  for (const name of yield* files.readDirectory(dir)) {
    const path = join(dir, name);
    if ((yield* files.stat(path)).type === 'Directory' && name !== '.git' && (yield* pruneEmpty(path))) {
      yield* files.remove(path, { recursive: true });
      continue;
    }
    empty = false;
  }
  return empty;
});

const rewrite = Effect.fnUntraced(function* (root: string, standing: readonly ScannedBlock[], rendered: RenderedTree) {
  const files = yield* FileSystem.FileSystem;
  for (const row of standing) yield* files.remove(join(root, row.path), { force: true });
  for (const [path, text] of rendered.files) {
    yield* files.makeDirectory(dirname(join(root, path)), { recursive: true });
    yield* files.writeFileString(join(root, path), text);
  }
  yield* pruneEmpty(root);
});

const folded = Effect.fnUntraced(function* (root: string, forest: readonly ScannedBlock[]) {
  if (forest.length === 0) return;
  const standing = yield* readBlockTree(root);
  const ids = new Set([...standing, ...forest].map((row) => row.frontmatter.id));
  const top = standing.find((row) => row.parentId === null)?.frontmatter.id ?? null;
  const placed = forest.map((row) => (row.parentId !== null && !ids.has(row.parentId) ? { ...row, parentId: top } : row));
  yield* rewrite(root, standing, yield* renderBlockTree([...standing, ...placed]));
});

const split = Effect.fnUntraced(function* (root: string, kept: ReadonlySet<string>) {
  const standing = yield* readBlockTree(root);
  const hidden = standing.filter((row) => kept.has(row.frontmatter.id));
  if (hidden.length > 0) {
    yield* rewrite(root, standing, yield* renderBlockTree(standing.filter((row) => !kept.has(row.frontmatter.id))));
  }
  return hidden;
});

const forestOf = Effect.fnUntraced(function* (root: string) {
  const rows: ScannedBlock[] = [];
  yield* visitForest(root, (row) => rows.push(row));
  return rows;
});

export type LayerMove = {
  readonly layer: LayerPlace;
  readonly kept: ReadonlySet<string>;
};

export const moveStorage = Effect.fnUntraced(function* ({
  git,
  from,
  to,
  checkout,
  origin,
  layers,
}: {
  readonly git: Git['Service'];
  readonly from: StorageLayout;
  readonly to: StorageLayout;
  readonly checkout: string;
  readonly origin: string | null;
  readonly layers: LayerMove;
}): Effect.fn.Return<
  boolean,
  | GateRefusal<'detached-checkout' | 'tree-missing' | 'target-holds-tree' | 'tree-mid-merge'>
  | OwnGitFailed
  | PlatformError
  | TreeCaptureFailed
  | BlockTreeUnreadable,
  FileSystem.FileSystem
> {
  const files = yield* FileSystem.FileSystem;
  const { layer, kept } = layers;
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
  const forest = from.mode === 'team' ? yield* forestOf(layer.treeRoot) : [];
  if (from.mode === 'team' && existsSync(layer.gitDir)) {
    yield* files.remove(layer.treeRoot, { recursive: true, force: true });
    yield* runGit(git, 'worktree-prune', ['--git-dir', layer.gitDir, 'worktree', 'prune']);
    if (to.mode === 'stealth' && !existsSync(to.gitDir)) yield* files.rename(layer.gitDir, to.gitDir);
  }
  const shadow = yield* prepare(git, to, checkout, origin);
  for (const name of yield* treeContent(to.treeRoot)) yield* files.remove(join(to.treeRoot, name), { recursive: true, force: true });
  for (const name of source) yield* travel(join(from.treeRoot, name), join(to.treeRoot, name));
  yield* folded(to.treeRoot, forest);
  const hidden = to.mode === 'team' && kept.size > 0 ? yield* split(to.treeRoot, kept) : [];
  yield* retire(git, from);
  if (shadow !== null) yield* shadow.commitAct(to.treeRoot, `storage moved to ${to.mode}`);
  const reshaped = forest.length > 0 || hidden.length > 0;
  if (from.mode !== 'stealth' || (hidden.length === 0 && origin === null)) return reshaped;
  if (!existsSync(layer.gitDir)) yield* files.rename(from.gitDir, layer.gitDir);
  const beside = yield* ShadowGit.open(layer.gitDir, git, origin);
  yield* beside.attach(layer.treeRoot, yield* branchOf(checkout));
  for (const name of yield* treeContent(layer.treeRoot)) yield* files.remove(join(layer.treeRoot, name), { recursive: true, force: true });
  for (const [path, text] of renderForest(hidden, (row) => row.parentId ?? '').files) {
    yield* files.makeDirectory(dirname(join(layer.treeRoot, path)), { recursive: true });
    yield* files.writeFileString(join(layer.treeRoot, path), text);
  }
  yield* beside.commitAct(layer.treeRoot, 'storage moved to team');
  return reshaped;
});
