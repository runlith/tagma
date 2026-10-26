import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { Clock, Effect, Schema } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { projectRoot, projectRootCover } from './tables.js';
import { ProjectCoverage, type ProjectRoot } from '../contract/wire/coverage.js';
import type { RootId } from '../contract/wire/ids.js';

const decodeCoverage = Schema.decodeUnknownEffect(ProjectCoverage);

export type CoverageStore = ReturnType<typeof makeCoverageStore>;

export const makeCoverageStore = ({ db }: { readonly db: StoreDb<'machine'> }) => {
  const coverage = Effect.fn('ProjectRootStore.coverage')(function* (
    projectId: number,
    paths: ReadonlyMap<RootId, string>,
    unit: Unit<'machine'>,
  ) {
    const cover = yield* unit.run(db.select().from(projectRootCover).where(eq(projectRootCover.projectId, projectId)).get());
    if (cover === undefined) return null;
    const rows = yield* unit.run(db.select().from(projectRoot).where(eq(projectRoot.projectId, projectId)).all());
    const associated = rows.length;
    const coverage = yield* decodeCoverage({
      projectId: cover.projectId,
      namespaceId: cover.namespaceId,
      rootPath: cover.rootPath,
      roots: rows.flatMap((row) => {
        const path = paths.get(row.rootId as RootId);
        return path === undefined ? [] : [{ projectId, rootId: row.rootId, path, origin: row.origin }];
      }),
      withheld: [],
    });
    return { coverage, associated };
  });

  const stamp = Effect.fn('ProjectRootStore.stamp')(function* (projectId: number, unit: Unit<'machine'>) {
    const row = yield* unit.run(db.select().from(projectRootCover).where(eq(projectRootCover.projectId, projectId)).get());
    return row ?? null;
  });

  const projectsOf = Effect.fn('ProjectRootStore.projectsOf')(function* (rootId: RootId, unit: Unit<'machine'>) {
    const rows = yield* unit.run(db.select({ projectId: projectRoot.projectId }).from(projectRoot).where(eq(projectRoot.rootId, rootId)));
    return rows.map((row) => row.projectId);
  });

  const rootIds = Effect.fn('ProjectRootStore.rootIds')(function* (projectId: number, unit: Unit<'machine'>) {
    const rows = yield* unit.run(
      db.select({ rootId: projectRoot.rootId }).from(projectRoot).where(eq(projectRoot.projectId, projectId)).all(),
    );
    return rows.map((row) => row.rootId as RootId);
  });

  const establish = Effect.fn('ProjectRootStore.establish')(function* (
    coverage: { projectId: number; namespaceId: string; rootPath: string; roots: readonly ProjectRoot[] },
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, StoreFailure> {
    const found = coverage.roots.map((root) => root.rootId);
    yield* unit.run(
      db
        .delete(projectRoot)
        .where(
          and(
            eq(projectRoot.projectId, coverage.projectId),
            inArray(projectRoot.origin, ['canonical', 'worktree']),
            found.length === 0 ? undefined : notInArray(projectRoot.rootId, found),
          ),
        ),
    );
    for (const root of coverage.roots) {
      yield* unit.run(
        db
          .insert(projectRoot)
          .values({
            projectId: coverage.projectId,
            rootId: root.rootId,
            origin: root.origin,
          })
          .onConflictDoUpdate({
            target: [projectRoot.projectId, projectRoot.rootId],
            set: { origin: root.origin },
          }),
      );
    }
    const covered = {
      projectId: coverage.projectId,
      namespaceId: coverage.namespaceId,
      rootPath: coverage.rootPath,
      at: new Date(yield* Clock.currentTimeMillis),
    };
    yield* unit.run(
      db
        .insert(projectRootCover)
        .values(covered)
        .onConflictDoUpdate({
          target: projectRootCover.projectId,
          set: { namespaceId: covered.namespaceId, rootPath: covered.rootPath, at: covered.at },
        }),
    );
  });

  const forget = Effect.fn('ProjectRootStore.forget')(function* (
    projectId: number,
    rootIds: readonly RootId[],
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, StoreFailure> {
    if (rootIds.length === 0) return;
    yield* unit.run(db.delete(projectRoot).where(and(eq(projectRoot.projectId, projectId), inArray(projectRoot.rootId, rootIds))));
  });

  const link = Effect.fn('ProjectRootStore.link')(function* (
    projectId: number,
    rootId: RootId,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, StoreFailure> {
    yield* unit.run(db.insert(projectRoot).values({ projectId, rootId, origin: 'worktree' }).onConflictDoNothing());
  });

  const unlink = Effect.fn('ProjectRootStore.unlink')(function* (
    projectId: number,
    rootId: RootId,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, StoreFailure> {
    yield* unit.run(db.delete(projectRoot).where(and(eq(projectRoot.projectId, projectId), eq(projectRoot.rootId, rootId))));
  });

  const adopt = Effect.fn('ProjectRootStore.adopt')(function* (
    projectId: number,
    rootId: RootId,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, StoreFailure> {
    yield* unit.run(
      db
        .insert(projectRoot)
        .values({ projectId, rootId, origin: 'adopted' })
        .onConflictDoUpdate({ target: [projectRoot.projectId, projectRoot.rootId], set: { origin: 'adopted' } }),
    );
  });

  return { coverage, stamp, projectsOf, rootIds, establish, forget, link, unlink, adopt };
};
