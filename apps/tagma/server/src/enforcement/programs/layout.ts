import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { dirname, join, posix } from 'node:path';
import { blobsAt, treeEntriesAt } from '@runlith/git/entries';
import { Git } from '@runlith/git/Git';
import { Effect, FileSystem, Option } from 'effect';
import { actingGit } from '../../platform/git/ownGit.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';

export type LaidFile = { readonly path: string; readonly text: string };

const BLOB_MODES: ReadonlySet<string> = new Set(['100644', '100755']);

export const reachFiles = Effect.fn('enforcement.program.layout.reach')(function* (
  root: string,
  tree: string,
  places: readonly string[],
  keep: (path: string) => boolean,
  failed: (reason: string) => InspectionFailed,
) {
  const service = yield* Effect.serviceOption(Git);
  if (Option.isNone(service))
    return yield* new InspectionFailed({ cause: 'git', reason: 'this server offers no git to read a whole reach' });
  const git = actingGit(service.value, 'inspection-files');
  const listed = yield* treeEntriesAt(git, root, tree, places.includes('') ? null : places);
  if (listed.unread.size > 0)
    return yield* new InspectionFailed({
      cause: 'git',
      reason: `the reach at ${tree} could not be listed: ${[...listed.unread.values()][0]}`,
    });
  const reached = [...listed.entries].filter(([path]) => keep(path));
  const unread = reached.find(([, entry]) => !BLOB_MODES.has(entry.mode));
  if (unread !== undefined) return yield* failed(`${unread[0]} at ${tree} is not a regular file (mode ${unread[1].mode})`);
  const paths = reached.map(([path]) => path).sort();
  const reads = yield* blobsAt(
    git,
    root,
    paths.map((path) => ({ tree, path })),
  ).pipe(
    Effect.mapError(
      (failure) => new InspectionFailed({ cause: 'git', reason: `the reach at ${tree} could not be read: ${failure.message}` }),
    ),
  );
  const files: LaidFile[] = [];
  for (const [at, path] of paths.entries()) {
    const read = reads[at];
    if (read?.status !== 'text')
      return yield* failed(`${path} at ${tree} is not text: ${read?.status === 'unread' ? read.reason : 'no blob answer'}`);
    files.push({ path, text: read.text });
  }
  return files;
});

export const treeFile = Effect.fn('enforcement.program.layout.file')(function* (
  root: string,
  tree: string,
  path: string,
  failed: (reason: string) => InspectionFailed,
) {
  const at = posix.normalize(path.replace(/^\/+/u, ''));
  if (at === '.' || at === '..' || at.startsWith('../')) return yield* failed(`${path} names no file inside the repository`);
  const [file] = yield* reachFiles(root, tree, [at], (one) => one === at, failed);
  return file ?? (yield* failed(`${path} is not in the judged tree ${tree}`));
});

export const scratchDir = Effect.fn('enforcement.program.layout.scratch')(function* (
  label: string,
  failed: (reason: string) => InspectionFailed,
) {
  const files = yield* FileSystem.FileSystem;
  const made = yield* Effect.acquireRelease(
    files
      .makeTempDirectory({ prefix: `tagma-${label}-` })
      .pipe(Effect.mapError((error) => failed(`its ${label} could not be made: ${String(error)}`))),
    (dir) => Effect.orDie(files.remove(dir, { recursive: true, force: true })),
  );
  return yield* files.realPath(made).pipe(Effect.mapError((error) => failed(`its ${label} could not be resolved: ${String(error)}`)));
}, Effect.provide(BunFileSystem.layer));

export const writeInto = Effect.fn('enforcement.program.layout.write')(function* (
  dir: string,
  layout: readonly LaidFile[],
  label: string,
  failed: (reason: string) => InspectionFailed,
) {
  const files = yield* FileSystem.FileSystem;
  const made = new Set<string>();
  for (const file of layout) {
    const target = join(dir, file.path);
    const parent = dirname(target);
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        if (!made.has(parent)) {
          yield* files.makeDirectory(parent, { recursive: true });
          made.add(parent);
        }
        yield* files.writeFileString(target, file.text);
      }),
    ).pipe(Effect.mapError((error) => failed(`its ${label} could not be written: ${String(error)}`)));
  }
}, Effect.provide(BunFileSystem.layer));
