import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Data, Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CHECKOUT_DIRECTORY, FORMAT_FILE, inGraphTree } from '../contract/wire/storage.js';
import { captureTree, type TreeCapture } from './batch.js';
import { validateTree } from './validation.js';
import { type BlockFileInvalid, decodeBlockFile } from './blockFile.js';
import { ShadowGit, stagedSides } from './shadow.js';
import { OwnGitFailed, gitAnswer, runGitBytes } from '../../platform/git/ownGit.js';
import { unmergedPaths } from '../../platform/git/unmerged.js';
import type { Git } from '@runlith/git/Git';
import type { TreeConflict } from '../contract/service/serving.js';

export class BlockConflict extends Data.TaggedError('BlockConflict')<{
  readonly path: string;
}> {}

export const treeConflicts = Effect.fnUntraced(function* (tree: {
  readonly treeRoot: string;
  readonly ownGit: boolean;
  readonly git: Git['Service'];
}) {
  const { treeRoot } = tree;
  const paths = yield* unmergedPaths(tree.git, treeRoot);
  const conflicts: TreeConflict[] = [];
  for (const path of paths) {
    const side = (yield* stagedSides(tree.git, treeRoot, path)).get(2);
    const decoded = side === undefined ? null : yield* Effect.result(decodeBlockFile(side));
    if (decoded?._tag === 'Failure') {
      conflicts.push({ path, blockId: null, evidence: JSON.stringify({ path, ownGit: tree.ownGit, unreadable: decoded.failure.message }) });
      continue;
    }
    conflicts.push({ path, blockId: decoded?.success.frontmatter.id ?? null, evidence: JSON.stringify({ path, ownGit: tree.ownGit }) });
  }
  return conflicts;
});

const sidesOf = Effect.fnUntraced(function* (staged: ReadonlyMap<number, string>) {
  const ids: string[] = [];
  let unreadable = '';
  for (const [stage, text] of staged) {
    const decoded = yield* Effect.result(decodeBlockFile(text));
    if (decoded._tag === 'Failure') unreadable += `; side ${stage} is unreadable: ${decoded.failure.message}`;
    else ids.push(decoded.success.frontmatter.id);
  }
  return { ids, unreadable };
});

export const validateMerge = Effect.fn('graph.validateMerge')(function* (
  git: Git['Service'],
  checkout: string,
  treeRoot: string,
  paths: readonly string[],
  capture: TreeCapture,
) {
  const attributes =
    paths.length === 0
      ? ''
      : yield* runGitBytes(git, 'graph-marker-size', ['-C', checkout, 'check-attr', '-z', '--stdin', 'conflict-marker-size'], {
          stdin: `${paths.join('\0')}\0`,
        });
  const fields = attributes.split('\0');
  const markers = new Map<string, number>();
  for (let at = 0; at + 2 < fields.length; at += 3) {
    const size = Number(fields[at + 2]);
    if (Number.isInteger(size) && size > 0) markers.set(fields[at]!, size);
  }
  for (const [path, file] of capture.files) {
    if (join(checkout, path) === join(treeRoot, FORMAT_FILE)) continue;
    const invalid = (failure: { readonly message: string }) =>
      new GateRefusal('files', `${path}: ${failure.message}`, [`resolve the working file ${path}, then resolve_graph_conflict again`]);
    const block = yield* decodeBlockFile(Buffer.from(file.bytes).toString('utf8'), markers.get(path)).pipe(Effect.mapError(invalid));
    const sides = yield* sidesOf(yield* stagedSides(git, checkout, path));
    if (sides.ids.length > 0 && !sides.ids.includes(block.frontmatter.id))
      return yield* invalid({ message: `the resolution carries id ${block.frontmatter.id}, which neither side holds${sides.unreadable}` });
  }
  yield* validateTree(treeRoot, 'tree').pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal('files', `${failure.path}: ${failure.message}`, [
          'resolve the graph tree structure, then resolve_graph_conflict again',
        ]),
    ),
  );
});

export const resolveCheckout = Effect.fn('graph.resolveCheckout')(function* (git: Git['Service'], checkout: string) {
  const merge = yield* gitAnswer(git, 'graph-merge-state', ['-C', checkout, 'rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  if (merge.status === 1) return yield* new GateRefusal('no-merge', 'no merge stands open in this checkout', ['read the checkout status']);
  if (merge.status !== 0)
    return yield* new OwnGitFailed({ op: 'graph-merge-state', message: merge.stderr.trim() || merge.stdout.trim(), ran: true });
  const open = yield* unmergedPaths(git, checkout);
  const paths = open.filter(inGraphTree);
  const capture = yield* captureTree(checkout, paths, () => false).pipe(
    Effect.mapError((failure) => new GateRefusal('files', failure.message, ['read the graph conflict files, then resolve again'])),
  );
  yield* validateMerge(git, checkout, join(checkout, CHECKOUT_DIRECTORY), paths, capture);
  const lines = paths.map((path) => `0 ${'0'.repeat(merge.stdout.trim().length)}\t${path}\0`);
  for (const [path, file] of capture.files) {
    const blob = yield* runGitBytes(git, 'graph-resolution-blob', ['-C', checkout, 'hash-object', '-w', `--path=${path}`, '--stdin'], {
      stdin: file.bytes,
    });
    lines.push(`${file.mode} ${blob.trim()}\t${path}\0`);
  }
  if (lines.length > 0)
    yield* runGitBytes(git, 'graph-resolution-stage', ['-C', checkout, 'update-index', '-z', '--index-info'], { stdin: lines.join('') });
  return { commit: null, resolved: paths, remaining: open.filter((path) => !inGraphTree(path)) };
});

export type ConflictResolution = {
  readonly merged: string | null;
  readonly remaining: readonly string[];
};

export const resolveConflict = Effect.fnUntraced(function* (
  shadow: ShadowGit,
  treeRoot: string,
  path: string,
  text: string,
): Effect.fn.Return<ConflictResolution, OwnGitFailed | BlockFileInvalid> {
  const standing = yield* shadow.unmergedPaths(treeRoot);
  if (!standing.includes(path)) {
    if (standing.length === 0 && (yield* shadow.mergeInProgress(treeRoot))) {
      const merged = yield* shadow.concludeMerge(treeRoot);
      return { merged, remaining: [] };
    }
    return yield* new OwnGitFailed({ op: 'resolve', message: `${path} is not in conflict`, ran: true });
  }
  const resolved = yield* decodeBlockFile(text);
  const sides = yield* sidesOf(yield* shadow.stagedSides(treeRoot, path));
  if (sides.ids.length > 0 && !sides.ids.includes(resolved.frontmatter.id)) {
    return yield* new OwnGitFailed({
      op: 'resolve',
      message: `the resolution carries id ${resolved.frontmatter.id}, which neither side of the merge holds${sides.unreadable}`,
      ran: true,
    });
  }
  writeFileSync(join(treeRoot, path), text);
  yield* shadow.stagePath(treeRoot, path);
  const remaining = yield* shadow.unmergedPaths(treeRoot);
  if (remaining.length > 0) return { merged: null, remaining };
  const merged = yield* shadow.concludeMerge(treeRoot);
  return { merged, remaining: [] };
});
