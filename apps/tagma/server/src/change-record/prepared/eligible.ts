import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { ignoredAmong } from '@runlith/git/entries';
import { statusAt } from '@runlith/git/status';
import type { Git } from '@runlith/git/Git';
import { actingGit, readingFailed } from '../../platform/git/ownGit.js';

function inCheckout(root: string, graphDirectory: string, path: string): boolean {
  if (path.startsWith('/')) return false;
  if (path === '.git' || path.startsWith('.git/')) return false;
  if (path === graphDirectory || path.startsWith(`${graphDirectory}/`)) return false;
  for (let at = dirname(path); at !== '.' && at !== '/' && at !== ''; at = dirname(at)) {
    if (existsSync(join(root, at, '.git'))) return false;
  }
  return true;
}

const PATH_BYTES = 8_000;

export function pathChunks(paths: readonly string[]): readonly (readonly string[])[] {
  const cut: string[][] = [];
  let bytes = PATH_BYTES;
  for (const path of paths) {
    const size = Buffer.byteLength(path, 'utf8') + 1;
    if (bytes + size > PATH_BYTES) {
      cut.push([]);
      bytes = 0;
    }
    (cut[cut.length - 1] as string[]).push(path);
    bytes += size;
  }
  return cut;
}

export const partitionPaths = (graphDirectory: string) =>
  Effect.fnUntraced(function* (git: Git['Service'], root: string, paths: readonly string[]) {
    const named = [...new Set(paths)].filter((path) => !path.startsWith('/'));
    const inside = named.filter((path) => inCheckout(root, graphDirectory, path));
    const outside = named.filter((path) => !inCheckout(root, graphDirectory, path));
    if (inside.length === 0) return { eligible: [], uncarriable: outside };
    const answer = yield* Effect.result(ignoredAmong(actingGit(git, 'ignored'), root, inside));
    if (answer._tag === 'Failure') {
      yield* Effect.logWarning('paths are carried without the ignore check: which of them git ignores could not be read', {
        root,
        reason: answer.failure.message,
      });
      return { eligible: inside, uncarriable: outside };
    }
    return {
      eligible: inside.filter((path) => !answer.success.has(path)),
      uncarriable: [...outside, ...inside.filter((path) => answer.success.has(path))],
    };
  });

export const eligiblePaths =
  (graphDirectory: string) =>
  (git: Git['Service'], root: string, paths: readonly string[]): Effect.Effect<readonly string[]> =>
    Effect.map(partitionPaths(graphDirectory)(git, root, paths), (parts) => parts.eligible);

export const changedWithin = Effect.fn('prepared.namedChanges')(function* (git: Git['Service'], root: string, paths: readonly string[]) {
  const found = new Set<string>();
  for (const cut of pathChunks(paths)) {
    const status = yield* Effect.mapError(
      statusAt(actingGit(git, 'submit-paths'), root, {
        untracked: 'all',
        paths: cut.map((path) => `:(literal)${path}`),
        monitor: false,
      }),
      (failure) => readingFailed('submit-paths', failure),
    );
    for (const area of [status.entries.staged, status.entries.unstaged, status.entries.untracked, status.entries.unmerged])
      for (const row of area) {
        found.add(row.path);
        if (row.oldPath !== undefined) found.add(row.oldPath);
      }
  }
  return [...found];
});

export type Standing = { readonly standing: readonly string[]; readonly clean: readonly string[] };

export const standingAmong = Effect.fn('prepared.standing')(function* (
  git: Git['Service'],
  root: string,
  paths: readonly string[],
): Effect.fn.Return<Standing> {
  const standing = new Set<string>();
  const read = new Set<string>();
  for (const cut of pathChunks(paths)) {
    const answer = yield* Effect.result(
      statusAt(actingGit(git, 'standing'), root, { untracked: 'all', paths: cut.map((path) => `:(literal)${path}`), monitor: false }),
    );
    if (answer._tag === 'Failure') {
      yield* Effect.logWarning('these paths stay unattributed: git status could not be read for them', {
        root,
        paths: cut.length,
        reason: answer.failure.message,
      });
      continue;
    }
    for (const path of cut) read.add(path);
    const { staged, unstaged, untracked, unmerged } = answer.success.entries;
    for (const area of [staged, unstaged, untracked, unmerged])
      for (const row of area) {
        standing.add(row.path);
        if (row.oldPath !== undefined) standing.add(row.oldPath);
      }
  }
  return {
    standing: paths.filter((path) => standing.has(path)),
    clean: paths.filter((path) => read.has(path) && !standing.has(path)),
  };
});
