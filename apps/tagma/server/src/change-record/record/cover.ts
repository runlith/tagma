import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { IntakeRefused } from '@runlith/agent-tools/WorkspaceChanges';
import { ignoredPaths } from '@runlith/git/entries';
import type { Git } from '@runlith/git/Git';
import { troubleOf } from '@runlith/git/repository';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { among } from '../../platform/store/rows.js';
import type { CheckoutPaths, CheckoutPlace } from '../../workspace/contract/service/checkoutPaths.js';
import { standing, workspaceChange } from '../store/tables.js';
import { inMetadata, type GitMetadata } from './metadata.js';

export type Covered = {
  readonly place: CheckoutPlace;
  readonly ignored: ReadonlySet<string>;
  readonly metadata: readonly string[];
};

export type Within = { readonly place: CheckoutPlace; readonly ignored: boolean } | null;

export const coveringTree = (trees: ReadonlyMap<string, readonly Covered[]>, path: string): readonly Covered[] | undefined => {
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    const found = trees.get(directory);
    if (found !== undefined) return found;
    if (directory === dirname(directory)) return undefined;
  }
};

const ignoredAt = (ignored: ReadonlySet<string>, path: string): boolean => {
  if (ignored.size === 0) return false;
  for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) if (ignored.has(path.slice(0, at))) return true;
  return ignored.has(path);
};

export const placeWithin = (covered: readonly Covered[], path: string, graphDirectory: string): Within => {
  for (const one of covered) {
    const root = one.place.root;
    if (!path.startsWith(`${root}/`)) continue;
    const relative = path.slice(root.length + 1);
    if (relative === graphDirectory || relative.startsWith(`${graphDirectory}/`)) return null;
    if (inMetadata(root, relative, one.metadata)) return null;
    return { place: { ...one.place, path: relative }, ignored: ignoredAt(one.ignored, relative) };
  }
  return null;
};

export const makeCover = ({
  store,
  units,
  paths,
  git,
  metadata,
}: {
  readonly store: MachineStore['Service'];
  readonly units: MachineUnits['Service'];
  readonly paths: CheckoutPaths['Service'];
  readonly git: Git['Service'];
  readonly metadata: GitMetadata;
}) => {
  const standingAmong = (checkout: string, paths: readonly string[]) =>
    units.read((unit) =>
      unit.run(
        store.db
          .selectDistinct({ path: workspaceChange.path })
          .from(workspaceChange)
          .where(and(eq(workspaceChange.checkout, checkout), standing, inArray(workspaceChange.path, among(paths)))),
      ),
    );

  const repositoryAt = (root: string, path: string) =>
    Effect.tryPromise({
      try: () =>
        lstat(join(root, '.git')).then(
          () => true,
          (cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? false : Promise.reject(cause)),
        ),
      catch: (cause) => new IntakeRefused({ path, reason: `Cannot read whether ${root} is a repository: ${String(cause)}` }),
    });

  const cover = Effect.fn('Intake.cover')(function* (path: string) {
    const unread = (failure: { readonly message: string }) => new IntakeRefused({ path, reason: failure.message });
    const own = yield* Effect.mapError(paths.placeAcross(path), unread);
    const within = yield* Effect.mapError(paths.rootsWithin(path), unread);
    const portions = [
      ...(own === null ? [] : [{ place: { ...own, path: '' }, portion: own.path }]),
      ...within.map((place) => ({ place: { ...place, path: '' }, portion: '' })),
    ];
    const covered = yield* Effect.forEach(
      portions,
      ({ place, portion }) =>
        Effect.map(
          Effect.all(
            [
              Effect.mapError(metadata.at(place.root), (failure) => new IntakeRefused({ path, reason: failure.reason })),
              Effect.flatMap(repositoryAt(place.root, path), (repository) =>
                repository
                  ? Effect.mapError(
                      ignoredPaths(git, place.root, { place: portion }),
                      (failure) => new IntakeRefused({ path, reason: `Cannot read which paths git ignores: ${troubleOf(failure)}` }),
                    )
                  : Effect.succeed([]),
              ),
            ],
            { concurrency: 'unbounded' },
          ),
          ([directories, ignored]): Covered => ({
            place,
            ignored: new Set(ignored.map((name) => (name.endsWith('/') ? name.slice(0, -1) : name))),
            metadata: directories,
          }),
        ),
      { concurrency: 'unbounded' },
    );
    return covered.sort((left, right) => right.place.root.length - left.place.root.length);
  });

  return { cover, standingAmong };
};
