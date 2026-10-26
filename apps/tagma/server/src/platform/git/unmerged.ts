import { stat } from 'node:fs/promises';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { type OwnGitFailed, runGit } from './ownGit.js';

export function unmergedPaths(git: Git['Service'], treeRoot: string): Effect.Effect<string[], OwnGitFailed> {
  return Effect.map(runGit(git, 'conflicts', ['-C', treeRoot, 'ls-files', '--unmerged', '--full-name', '-z', '--', '.']), (out) => [
    ...new Set(
      out
        .split('\0')
        .filter((record) => record.includes('\t'))
        .map((record) => record.slice(record.indexOf('\t') + 1)),
    ),
  ]);
}

const indexIdentity = (path: string): Effect.Effect<string> =>
  Effect.promise(() =>
    stat(path).then(
      (found) => `${found.ino}:${found.size}:${found.mtimeMs}`,
      (cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? 'none' : Promise.reject(cause)),
    ),
  );

export type UnmergedTracker = {
  readonly read: Effect.Effect<string[], OwnGitFailed>;
  readonly cleanAfterOwnCommit: Effect.Effect<void>;
};

export function unmergedTracker(git: Git['Service'], treeRoot: string): UnmergedTracker {
  let index: string | null = null;
  let held: { readonly at: string; readonly paths: string[] } | null = null;
  const read = Effect.gen(function* () {
    index ??= yield* runGit(git, 'index-path', ['-C', treeRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'index']);
    const at = yield* indexIdentity(index);
    if (held !== null && held.at === at) return held.paths;
    const paths = yield* unmergedPaths(git, treeRoot);
    held = { at, paths };
    return paths;
  });
  const cleanAfterOwnCommit = Effect.gen(function* () {
    if (index === null) return;
    held = { at: yield* indexIdentity(index), paths: [] };
  });
  return { read, cleanAfterOwnCommit };
}

export function unmergedReader(git: Git['Service'], treeRoot: string): Effect.Effect<string[], OwnGitFailed> {
  return unmergedTracker(git, treeRoot).read;
}
