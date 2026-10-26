import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { MachineStore, type StoreDb, type StoreFailure } from '../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';
import { type Filing, type FolderMoved, ThreadFolders } from './contract/service/folders.js';
import type { ThreadFolder } from './contract/wire/folder.js';
import { liveRootOf } from './lineage.js';
import { threadFolder } from './store/folders.js';
import { threadRecord } from './store/table.js';

const folderColumns = {
  id: threadFolder.id,
  name: threadFolder.name,
  position: threadFolder.position,
  parentId: threadFolder.parentId,
};

const childrenOf = (folders: readonly ThreadFolder[], parentId: string | null) => folders.filter((folder) => folder.parentId === parentId);

const subtreeOf = (folders: readonly ThreadFolder[], rootId: string): readonly string[] => {
  const ids = [rootId];
  for (let at = 0; at < ids.length; at += 1) for (const child of childrenOf(folders, ids[at] as string)) ids.push(child.id);
  return ids;
};

const renumber = Effect.fn('threadRecord.renumber')(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  siblings: readonly ThreadFolder[],
  parentId: string | null,
) {
  for (const [position, folder] of siblings.entries()) {
    if (folder.position === position && folder.parentId === parentId) continue;
    yield* unit.run(db.update(threadFolder).set({ position, parentId }).where(eq(threadFolder.id, folder.id)));
  }
  return siblings.map((folder, position) => ({ ...folder, position, parentId }));
});

const foldersOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, projectId: number) =>
  unit.run(
    db
      .select(folderColumns)
      .from(threadFolder)
      .where(eq(threadFolder.projectId, projectId))
      .orderBy(asc(threadFolder.position), asc(threadFolder.id)),
  );

const folderIn = (db: StoreDb<'machine'>, unit: Unit<'machine'>, projectId: number, folderId: string) =>
  unit.run(
    db
      .select(folderColumns)
      .from(threadFolder)
      .where(and(eq(threadFolder.id, folderId), eq(threadFolder.projectId, projectId)))
      .get(),
  );

type Roots = { readonly roots: readonly ThreadId[]; readonly missing: readonly string[] };

const rootsIn = Effect.fn('threadRecord.rootsIn')(function* (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  projectId: number,
  threadIds: readonly string[],
): Effect.fn.Return<Roots, StoreFailure> {
  const roots: ThreadId[] = [];
  const missing: string[] = [];
  for (const id of threadIds) {
    const root = yield* unit.run(
      db
        .select({ id: threadRecord.id })
        .from(threadRecord)
        .where(and(sql`${threadRecord.id} = ${liveRootOf(id)}`, eq(threadRecord.projectId, projectId)))
        .get(),
    );
    if (root === undefined) missing.push(id);
    else if (!roots.includes(root.id as ThreadId)) roots.push(root.id as ThreadId);
  }
  return { roots, missing };
});

const assign = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  roots: readonly ThreadId[],
  folderId: string | null,
) {
  if (roots.length === 0) return [];
  const moved = yield* unit.run(
    db
      .update(threadRecord)
      .set({ folderId, pinnedAt: null })
      .where(
        and(inArray(threadRecord.id, roots), sql`(${threadRecord.folderId} is not ${folderId} or ${threadRecord.pinnedAt} is not null)`),
      )
      .returning({ id: threadRecord.id }),
  );
  return moved.map((row) => row.id as ThreadId);
});

export const makeThreadFolders = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const folding = (operation: string) => writes(`ThreadFolders.${operation}`, [threadFolder, threadRecord]);
  return ThreadFolders.of({
    list: (projectId) => units.read((unit) => foldersOf(db, unit, projectId)),

    create: Effect.fn('ThreadFolders.create')((projectId, name, parentId, threadIds) =>
      units.write(folding('create'), (unit) =>
        Effect.gen(function* () {
          const standing = yield* foldersOf(db, unit, projectId);
          if (parentId !== null && !standing.some((folder) => folder.id === parentId)) return { status: 'no-parent' as const };
          const members = yield* rootsIn(db, unit, projectId, threadIds);
          if (members.missing.length > 0) return { status: 'missing' as const, missing: members.missing };
          const position = childrenOf(standing, parentId).reduce((next, sibling) => Math.max(next, sibling.position + 1), 0);
          const [folder] = yield* unit.run(
            db.insert(threadFolder).values({ projectId, parentId, name, position }).returning(folderColumns),
          );
          if (folder === undefined) return yield* Effect.die(new Error('a folder insert answered no row'));
          return { status: 'created' as const, folder, moved: yield* assign(db, unit, members.roots, folder.id) };
        }),
      ),
    ),

    rename: (projectId, folderId, name) =>
      units.write(folding('rename'), (unit) =>
        Effect.map(
          unit.run(
            db
              .update(threadFolder)
              .set({ name })
              .where(and(eq(threadFolder.id, folderId), eq(threadFolder.projectId, projectId)))
              .returning(folderColumns),
          ),
          (rows) => rows[0],
        ),
      ),

    move: Effect.fn('ThreadFolders.move')((projectId, folderId, parentId, index) =>
      units.write(folding('move'), (unit): Effect.Effect<FolderMoved, StoreFailure> =>
        Effect.gen(function* () {
          const standing = yield* foldersOf(db, unit, projectId);
          const moving = standing.find((folder) => folder.id === folderId);
          if (moving === undefined) return { status: 'no-folder' };
          const into = parentId === undefined ? moving.parentId : parentId;
          if (into !== null) {
            if (!standing.some((folder) => folder.id === into)) return { status: 'no-parent' };
            if (subtreeOf(standing, folderId).includes(into)) return { status: 'cycle' };
          }
          const leaving = childrenOf(standing, moving.parentId).filter((folder) => folder.id !== folderId);
          const arriving = into === moving.parentId ? leaving : childrenOf(standing, into);
          arriving.splice(Math.min(index, arriving.length), 0, moving);
          const placed = new Map<string, ThreadFolder>();
          if (into !== moving.parentId)
            for (const folder of yield* renumber(db, unit, leaving, moving.parentId)) placed.set(folder.id, folder);
          for (const folder of yield* renumber(db, unit, arriving, into)) placed.set(folder.id, folder);
          const folders = standing.map((folder) => placed.get(folder.id) ?? folder);
          folders.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
          return { status: 'moved', folders };
        }),
      ),
    ),

    remove: Effect.fn('ThreadFolders.remove')((projectId, folderId) =>
      units.write(folding('remove'), (unit) =>
        Effect.gen(function* () {
          const standing = yield* foldersOf(db, unit, projectId);
          const folder = standing.find((held) => held.id === folderId);
          if (folder === undefined) return undefined;
          const removed = subtreeOf(standing, folderId);
          const filed = yield* unit.run(
            db
              .select({ id: threadRecord.id, folderId: threadRecord.folderId })
              .from(threadRecord)
              .where(inArray(threadRecord.folderId, removed)),
          );
          yield* unit.run(db.update(threadRecord).set({ folderId: null }).where(inArray(threadRecord.folderId, removed)));
          yield* unit.run(db.delete(threadFolder).where(inArray(threadFolder.id, removed)));
          yield* renumber(
            db,
            unit,
            childrenOf(standing, folder.parentId).filter((sibling) => sibling.id !== folderId),
            folder.parentId,
          );
          return { folder, removed, released: filed.map((row) => ({ threadId: row.id as ThreadId, folderId: row.folderId as string })) };
        }),
      ),
    ),

    file: Effect.fn('ThreadFolders.file')((projectId, threadIds, folderId) =>
      units.write(folding('file'), (unit): Effect.Effect<Filing, StoreFailure> =>
        Effect.gen(function* () {
          if (folderId !== null && (yield* folderIn(db, unit, projectId, folderId)) === undefined) return { status: 'no-folder' };
          const members = yield* rootsIn(db, unit, projectId, threadIds);
          if (members.missing.length > 0) return { status: 'missing', missing: members.missing };
          return { status: 'filed', roots: members.roots, moved: yield* assign(db, unit, members.roots, folderId) };
        }),
      ),
    ),
  });
});

export const threadFoldersLayer = Layer.effect(ThreadFolders, makeThreadFolders);
