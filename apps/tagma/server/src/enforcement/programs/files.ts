import type { ProgramSide, SourceText } from '@tagma/inspection/program';
import { blobsAt, treeEntriesAt } from '@runlith/git/entries';
import { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import { actingGit } from '../../platform/git/ownGit.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';

const LINKS = new Set(['120000', '160000']);

const readsAt = Effect.fn('enforcement.program.files')(function* (root: string, tree: string, paths: readonly string[]) {
  if (paths.length === 0) return [];
  return yield* blobsAt(
    actingGit(yield* Git, 'inspection-files'),
    root,
    paths.map((path) => ({ tree, path })),
  ).pipe(
    Effect.mapError(
      (failure) => new InspectionFailed({ cause: 'git', reason: `git could not read the changed files at ${tree}: ${failure.message}` }),
    ),
  );
});

export const sideAt = Effect.fn('enforcement.program.sideFiles')(function* (
  root: string,
  tree: string,
  paths: readonly string[],
  side: ProgramSide['side'],
) {
  const sources = new Set(paths);
  if (paths.length > 0) {
    const listed = yield* treeEntriesAt(actingGit(yield* Git, 'inspection-files'), root, tree, paths);
    if (listed.unread.size > 0)
      return yield* new InspectionFailed({
        cause: 'git',
        reason: `the ${side} input could not read regular files: ${[...listed.unread.values()][0]}`,
      });
    for (const [path, entry] of listed.entries) if (LINKS.has(entry.mode)) sources.delete(path);
  }
  const read = [...sources];
  const reads = yield* readsAt(root, tree, read);
  const files: SourceText[] = [];
  for (const [at, path] of read.entries()) {
    const read = reads[at];
    if (read === undefined || read.status === 'unread')
      return yield* new InspectionFailed({
        cause: 'git',
        reason: `the ${side} input could not read ${path}: ${read?.reason ?? 'no blob answer'}`,
      });
    if (read.status === 'text') files.push({ path, text: read.text });
  }
  return { side, paths: files.map((file) => file.path), files } satisfies ProgramSide;
});
