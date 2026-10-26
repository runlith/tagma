import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { carryingAt, treeBlobsAt, treePathsAt } from '@runlith/git/treePaths';
import { actingGit, type OwnGitFailed, readingFailed } from '../platform/git/ownGit.js';
import { CONFIG_FILE } from './contract/wire/config.js';

export type Found = { readonly blob: string; readonly text: string };

const FILE_MODES = new Set(['100644', '100755']);

const text = new TextDecoder('utf-8', { ignoreBOM: true });

export const filesAt = Effect.fn('Configs.files')(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  paths: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, Found | null>, OwnGitFailed> {
  const read = yield* treeBlobsAt(actingGit(git, 'config-files'), root, tree, paths);
  const found = new Map<string, Found | null>();
  for (const [path, one] of read) {
    if (one._tag === 'Failure') return yield* readingFailed('config-files', one.failure);
    found.set(
      path,
      one.success === null || !FILE_MODES.has(one.success.mode) ? null : { blob: one.success.blob, text: text.decode(one.success.bytes) },
    );
  }
  return found;
});

export const carriedAt = (git: Git['Service'], root: string, commits: readonly string[]) =>
  carryingAt(actingGit(git, 'config-carried'), root, commits, CONFIG_FILE).pipe(
    Effect.mapError((failure) => readingFailed('config-carried', failure)),
  );

export const blobsAt = Effect.fn('Configs.blobs')(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  paths: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, string | null>, OwnGitFailed> {
  const read = yield* treePathsAt(actingGit(git, 'config-blobs'), root, tree, paths);
  const found = new Map<string, string | null>();
  for (const [path, one] of read) {
    if (one._tag === 'Failure') return yield* readingFailed('config-blobs', one.failure);
    found.set(path, one.success === null || !FILE_MODES.has(one.success.mode) ? null : one.success.blob);
  }
  return found;
});
