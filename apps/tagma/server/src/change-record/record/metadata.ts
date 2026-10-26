import { lstat, realpath } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import { Data, Effect } from 'effect';
import { and, sql } from 'drizzle-orm';
import { Git } from '@runlith/git/Git';
import { insideRepository, locationsAt } from '@runlith/git/repository';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { FileRoots } from '../../workspace/contract/service/roots.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import { configuredGit } from '../../platform/git/ownGit.js';
import { changeLogWrites, standing, workspaceChange } from '../store/tables.js';
import { type StoreShape, samePlaces } from './places.js';
import { releaseVersions } from './versions.js';

export class MetadataUnread extends Data.TaggedError('MetadataUnread')<{ readonly path: string; readonly reason: string }> {}

const unread = (path: string, failure: unknown): MetadataUnread =>
  new MetadataUnread({ path, reason: failure instanceof Error ? failure.message : String(failure) });

const within = (path: string, directory: string): boolean => path === directory || insideRepository(directory, path);

export const metadataPath = (path: string): boolean => path.split('/').includes('.git');

export const inMetadata = (root: string, path: string, directories: readonly string[]): boolean =>
  metadataPath(path) || directories.some((directory) => within(resolve(root, path), directory));

const statAt = (path: string): Effect.Effect<Stats | null, MetadataUnread> =>
  Effect.tryPromise({ try: () => lstat(path), catch: (failure) => failure as NodeJS.ErrnoException }).pipe(
    Effect.catch((failure) =>
      failure.code === 'ENOENT' || failure.code === 'ENOTDIR' ? Effect.succeed(null) : Effect.fail(unread(path, failure)),
    ),
  );

const stampOf = (info: Stats | null): string =>
  info === null ? 'absent' : `${info.dev}:${info.ino}${info.isDirectory() ? '' : `:${info.size}:${info.mtimeMs}:${info.ctimeMs}`}`;

export type GitMetadata = Effect.Success<typeof makeGitMetadata>;

export const makeGitMetadata = Effect.gen(function* () {
  const git = yield* Git;
  const known = new Map<string, { readonly stamp: string; readonly commonMarker: string; readonly directories: readonly string[] }>();
  const at = Effect.fn('GitMetadata.at')(function* (root: string) {
    const marker = join(root, '.git');
    const info = yield* statAt(marker);
    if (info === null) {
      known.delete(root);
      return [];
    }
    const standing = known.get(root);
    const commonMarker = info.isDirectory() ? join(marker, 'commondir') : standing?.commonMarker;
    const common = commonMarker === undefined ? null : yield* statAt(commonMarker);
    if (info.isDirectory() && common === null) {
      known.delete(root);
      return [];
    }
    const stamp = `${stampOf(info)}:${stampOf(common)}`;
    if (standing?.stamp === stamp) return standing.directories;
    const locations = yield* locationsAt(configuredGit(git, 'change-metadata'), root).pipe(
      Effect.mapError((failure) => unread(marker, failure)),
    );
    const directories = yield* Effect.tryPromise({
      try: () => Promise.all([...new Set([locations.gitDir, locations.commonDir])].map((path) => realpath(path))),
      catch: (failure) => unread(marker, failure),
    });
    const resolvedMarker = join(locations.gitDir, 'commondir');
    const resolvedCommon = resolvedMarker === commonMarker ? common : yield* statAt(resolvedMarker);
    known.set(root, { stamp: `${stampOf(info)}:${stampOf(resolvedCommon)}`, commonMarker: resolvedMarker, directories });
    return directories;
  });
  return {
    at,
    contains: (root: string, path: string): Effect.Effect<boolean, MetadataUnread> =>
      metadataPath(path) ? Effect.succeed(true) : Effect.map(at(root), (directories) => inMetadata(root, path, directories)),
    keep: (root: string, paths: readonly string[]) =>
      Effect.map(at(root), (directories) => paths.filter((path) => !inMetadata(root, path, directories))),
  };
});

const PAGE = 256;

export const pruneMetadata = Effect.fn('ChangeRecord.pruneMetadata')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  roots: FileRoots['Service'],
  metadata: GitMetadata,
) {
  const known = new Map<string, { readonly root: string; readonly directories: readonly string[] } | null>();
  let after: PlacedPath | undefined;
  let removed = 0;
  let unreadCheckouts = 0;
  for (;;) {
    const page: readonly PlacedPath[] = yield* units.read((unit) =>
      unit.run(
        store.db
          .selectDistinct({ checkout: workspaceChange.checkout, path: workspaceChange.path })
          .from(workspaceChange)
          .where(
            and(
              standing,
              after === undefined
                ? undefined
                : sql`(${workspaceChange.checkout}, ${workspaceChange.path}) > (${after.checkout}, ${after.path})`,
            ),
          )
          .orderBy(workspaceChange.checkout, workspaceChange.path)
          .limit(PAGE),
      ),
    );
    const gone: PlacedPath[] = [];
    for (const place of page) {
      if (metadataPath(place.path)) {
        gone.push(place);
        continue;
      }
      let located = known.get(place.checkout);
      if (located === undefined) {
        const read = yield* Effect.result(roots.read(RootId.make(place.checkout)));
        located = null;
        const root = read._tag === 'Success' ? read.success : null;
        const directories = root === null || root.state !== 'active' ? null : yield* Effect.result(metadata.at(root.path));
        const failure =
          read._tag === 'Failure' && read.failure._tag !== 'RootMissing'
            ? read.failure
            : directories?._tag === 'Failure'
              ? directories.failure
              : null;
        if (failure !== null) {
          unreadCheckouts += 1;
          yield* Effect.logWarning('Git metadata of this checkout could not be read; its records wait for the next start', {
            checkout: place.checkout,
            failure,
          });
        } else if (root !== null && directories?._tag === 'Success') {
          located = { root: root.path, directories: directories.success };
        }
        known.set(place.checkout, located);
      }
      if (located !== null && inMetadata(located.root, place.path, located.directories)) gone.push(place);
    }
    if (gone.length > 0) {
      removed += yield* units.write(changeLogWrites, () =>
        Effect.gen(function* () {
          const rows = yield* store.db
            .delete(workspaceChange)
            .where(samePlaces(workspaceChange, gone))
            .returning({ before: workspaceChange.beforeHash, after: workspaceChange.afterHash });
          yield* releaseVersions(
            store.db,
            rows.flatMap((row) => [row.before, row.after]),
          );
          return rows.length;
        }),
      );
    }
    after = page[page.length - 1];
    if (page.length < PAGE) return { removed, unreadCheckouts };
  }
});
