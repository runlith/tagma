import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../platform/contract/service/store.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';
import type { Detached, DetachRefused, ReattachRefused, Reattached } from './contract/service/records.js';
import { liveRootOf, subtreeOf } from './lineage.js';
import { threadRecord } from './store/table.js';
import { setArchived } from './shelf.js';

const inSubtree = (id: string) => sql`${threadRecord.id} in ${subtreeOf(id)}`;

const ids = (rows: readonly { readonly id: string }[]): readonly ThreadId[] => rows.map((row) => row.id as ThreadId);

export const detach = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  id: string,
  at: Date,
): Effect.fn.Return<Detached | DetachRefused, StoreFailure> {
  const row = yield* unit.run(
    db
      .select({
        parentId: threadRecord.parentId,
        spawnRootId: threadRecord.spawnRootId,
        projectId: threadRecord.projectId,
        pinnedAt: threadRecord.pinnedAt,
        archivedAt: threadRecord.archivedAt,
        detachedFrom: threadRecord.detachedFrom,
        detachedAt: threadRecord.detachedAt,
      })
      .from(threadRecord)
      .where(eq(threadRecord.id, id))
      .get(),
  );
  if (row === undefined || row.parentId === null) {
    return {
      status: 'not-a-child' as const,
      detachedFrom: (row?.detachedFrom ?? null) as ThreadId | null,
      detachedAt: row?.detachedAt ?? null,
    };
  }
  if (row.archivedAt !== null) yield* setArchived(db, unit, [id], null);
  const root = yield* unit.run(
    db
      .select({ pinnedAt: threadRecord.pinnedAt, folderId: threadRecord.folderId, projectId: threadRecord.projectId })
      .from(threadRecord)
      .where(sql`${threadRecord.id} = ${liveRootOf(id)}`)
      .get(),
  );
  const folderId = root !== undefined && root.projectId === row.projectId ? root.folderId : null;
  const subtree = ids(yield* unit.run(db.select({ id: threadRecord.id }).from(threadRecord).where(inSubtree(id))));
  const lifted = new Set<string>(subtree);
  const team = ids(
    yield* unit.run(db.select({ id: threadRecord.id }).from(threadRecord).where(eq(threadRecord.spawnRootId, row.spawnRootId))),
  ).filter((member) => !lifted.has(member));
  yield* unit.run(
    db
      .update(threadRecord)
      .set({
        parentId: null,
        detachedFrom: row.parentId,
        detachedAt: at,
        folderId,
        pinnedAt: folderId !== null && root?.pinnedAt == null ? null : row.pinnedAt,
      })
      .where(eq(threadRecord.id, id)),
  );
  yield* unit.run(
    db
      .update(threadRecord)
      .set({ spawnRootId: id })
      .where(inArray(threadRecord.id, [...subtree])),
  );
  return {
    status: 'detached' as const,
    from: row.parentId as ThreadId,
    subtree,
    team,
    formerRootPinned: root?.pinnedAt != null,
  };
});

export const reattach = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  id: string,
): Effect.fn.Return<Reattached | ReattachRefused, StoreFailure> {
  const row = yield* unit.run(
    db
      .select({
        parentId: threadRecord.parentId,
        detachedFrom: threadRecord.detachedFrom,
        detachedAt: threadRecord.detachedAt,
        archivedAt: threadRecord.archivedAt,
        principalId: threadRecord.principalId,
      })
      .from(threadRecord)
      .where(eq(threadRecord.id, id))
      .get(),
  );
  if (row === undefined || row.parentId !== null || row.detachedFrom === null || row.detachedAt === null) {
    return { status: 'not-detached' as const };
  }
  if (row.archivedAt !== null) yield* setArchived(db, unit, [id], null);
  const under = row.detachedFrom;
  const parent = yield* unit.run(
    db
      .select({ spawnRootId: threadRecord.spawnRootId, archivedAt: threadRecord.archivedAt })
      .from(threadRecord)
      .where(eq(threadRecord.id, under))
      .get(),
  );
  if (parent === undefined) return { status: 'not-detached' as const };
  if (parent.archivedAt !== null) return { status: 'parent-archived' as const, parent: under as ThreadId };
  const named = yield* unit.run(
    db
      .select({ name: threadRecord.name })
      .from(threadRecord)
      .where(and(inSubtree(id), isNotNull(threadRecord.name))),
  );
  const names = named.flatMap((member) => (member.name === null ? [] : [member.name]));
  if (names.length > 0) {
    const holder = yield* unit.run(
      db
        .select({ id: threadRecord.id, name: threadRecord.name })
        .from(threadRecord)
        .where(
          and(
            eq(threadRecord.principalId, row.principalId),
            eq(threadRecord.spawnRootId, parent.spawnRootId),
            inArray(threadRecord.name, names),
          ),
        )
        .get(),
    );
    if (holder !== undefined && holder.name !== null) {
      return { status: 'name-taken' as const, name: holder.name, holder: holder.id as ThreadId };
    }
  }
  const subtree = ids(yield* unit.run(db.select({ id: threadRecord.id }).from(threadRecord).where(inSubtree(id))));
  yield* unit.run(
    db.update(threadRecord).set({ parentId: under, detachedFrom: null, detachedAt: null, folderId: null }).where(eq(threadRecord.id, id)),
  );
  yield* unit.run(
    db
      .update(threadRecord)
      .set({ spawnRootId: parent.spawnRootId })
      .where(inArray(threadRecord.id, [...subtree])),
  );
  return { status: 'reattached' as const, under: under as ThreadId, detachedAt: row.detachedAt, subtree };
});
