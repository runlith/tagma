import { and, asc, eq, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { Cause, Effect, Exit, Layer } from 'effect';
import { uuidv7 } from 'uuidv7';
import { MachineStore, type StoreDb, type StoreFailure } from '../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { ProjectGroups } from '../projects/contract/service/registry.js';
import { type Filing, type FolderMoved, type FoldersRegrouped, ThreadFolders } from './contract/service/folders.js';
import type { ThreadFolder } from './contract/wire/folder.js';
import { liveRootOf } from './lineage.js';
import { absorbFolders, type FolderPlan, type HeldFolder, type PlacedFolder, partFolders } from './regroup.js';
import { threadFolder } from './store/folders.js';
import { threadRecord } from './store/table.js';

const folderColumns = {
  id: threadFolder.id,
  name: threadFolder.name,
  position: threadFolder.position,
  parentId: threadFolder.parentId,
};

type FolderOwner = { readonly id: number; readonly homes: readonly number[]; readonly member: number | null };

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

const foldersOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, ownerId: number) =>
  unit.run(
    db
      .select(folderColumns)
      .from(threadFolder)
      .where(eq(threadFolder.projectId, ownerId))
      .orderBy(asc(threadFolder.position), asc(threadFolder.id)),
  );

const heldOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, ownerId: number): Effect.Effect<readonly HeldFolder[], StoreFailure> =>
  unit.run(
    db
      .select({ ...folderColumns, memberId: threadFolder.memberId })
      .from(threadFolder)
      .where(eq(threadFolder.projectId, ownerId)),
  );

const folderIn = (db: StoreDb<'machine'>, unit: Unit<'machine'>, ownerId: number, folderId: string) =>
  unit.run(
    db
      .select(folderColumns)
      .from(threadFolder)
      .where(and(eq(threadFolder.id, folderId), eq(threadFolder.projectId, ownerId)))
      .get(),
  );

const nextTop = (db: StoreDb<'machine'>, unit: Unit<'machine'>, ownerId: number) =>
  Effect.map(
    unit.run(
      db
        .select({ top: max(threadFolder.position) })
        .from(threadFolder)
        .where(and(eq(threadFolder.projectId, ownerId), isNull(threadFolder.parentId)))
        .get(),
    ),
    (row) => (row?.top ?? -1) + 1,
  );

type Roots = { readonly roots: readonly ThreadId[]; readonly missing: readonly string[] };

const rootsIn = Effect.fn('threadRecord.rootsIn')(function* (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  homes: readonly number[],
  threadIds: readonly string[],
): Effect.fn.Return<Roots, StoreFailure> {
  const roots: ThreadId[] = [];
  const missing: string[] = [];
  for (const id of threadIds) {
    const root = yield* unit.run(
      db
        .select({ id: threadRecord.id })
        .from(threadRecord)
        .where(and(sql`${threadRecord.id} = ${liveRootOf(id)}`, inArray(threadRecord.projectId, [...homes])))
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

const place = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, placed: readonly PlacedFolder[]) {
  for (const folder of placed) {
    yield* unit.run(
      db
        .update(threadFolder)
        .set({ projectId: folder.ownerId, parentId: folder.parentId, position: folder.position, memberId: folder.memberId })
        .where(eq(threadFolder.id, folder.id)),
    );
  }
});

const carryOut = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, plan: FolderPlan) {
  yield* place(db, unit, plan.placed);
  if (plan.copied.length > 0) {
    yield* unit.run(
      db.insert(threadFolder).values(
        plan.copied.map((folder) => ({
          id: folder.id,
          projectId: folder.ownerId,
          parentId: folder.parentId,
          memberId: folder.memberId,
          name: folder.name,
          position: folder.position,
        })),
      ),
    );
  }
  for (const root of plan.refiled) {
    yield* unit.run(db.update(threadRecord).set({ folderId: root.folderId }).where(eq(threadRecord.id, root.threadId)));
  }
});

type Subscriber = (event: FoldersRegrouped) => Effect.Effect<void, StoreFailure>;

export const makeThreadFolders = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const groups = yield* ProjectGroups;
  const changes = yield* ProjectChanges;
  const subscribers = new Set<Subscriber>();
  const folding = (operation: string) => writes(`ThreadFolders.${operation}`, [threadFolder, threadRecord]);

  const ownerOf = (projectId: number): Effect.Effect<FolderOwner, StoreFailure> =>
    Effect.map(groups.of(projectId), (group) => {
      if (group === undefined) return { id: projectId, homes: [projectId], member: null };
      const homes = group.members.map((member) => member.id);
      return { id: group.graph.id, homes, member: group.graph.id === projectId ? (homes[0] ?? null) : projectId };
    });

  const owned = <A>(
    projectId: number,
    operation: string,
    work: (unit: WriteUnit<'machine'>, owner: FolderOwner) => Effect.Effect<A, StoreFailure>,
  ) => units.write(folding(operation), (unit) => Effect.flatMap(ownerOf(projectId), (owner) => work(unit, owner)));

  const regroup = Effect.fn('ThreadFolders.regroup')(function* (groupId: number) {
    return yield* units.write(folding('regroup'), (unit) =>
      Effect.gen(function* () {
        const held = yield* groups.list();
        const members = (held.find((group) => group.graph.id === groupId)?.members ?? []).map((member) => member.id);
        const entering: { readonly memberId: number; readonly folders: readonly HeldFolder[] }[] = [];
        for (const memberId of members) {
          const folders = yield* heldOf(db, unit, memberId);
          if (folders.length > 0) entering.push({ memberId, folders });
        }
        if (entering.length > 0) {
          const standing = new Map([[groupId, yield* nextTop(db, unit, groupId)]]);
          yield* place(db, unit, absorbFolders({ groupId, entering, standing }));
        }
        const folders = yield* heldOf(db, unit, groupId);
        if (folders.length === 0) return { receivers: [] as readonly number[], refiled: [] as readonly ThreadId[] };
        const filed = yield* unit.run(
          db
            .select({ threadId: threadRecord.id, folderId: sql<string>`${threadRecord.folderId}`, home: threadRecord.projectId })
            .from(threadRecord)
            .where(
              inArray(
                threadRecord.folderId,
                folders.map((folder) => folder.id),
              ),
            ),
        );
        const departed = new Set([
          ...filed.flatMap((root) => (root.home === null || members.includes(root.home) ? [] : [root.home])),
          ...folders.flatMap((folder) => (folder.memberId === null || members.includes(folder.memberId) ? [] : [folder.memberId])),
        ]);
        const owners = new Map(
          [...departed].map(
            (home) => [home, held.find((group) => group.members.some((one) => one.id === home))?.graph.id ?? home] as const,
          ),
        );
        const standing = new Map<number, number>();
        for (const owner of new Set(owners.values())) standing.set(owner, yield* nextTop(db, unit, owner));
        const plan = partFolders({ groupId, members, owners, folders, filed, standing, newId: uuidv7 });
        yield* carryOut(db, unit, plan);
        return {
          receivers: [...new Set([...departed, ...standing.keys()])],
          refiled: plan.refiled.map((root) => root.threadId as ThreadId),
        };
      }),
    );
  });

  const announce = (event: FoldersRegrouped) =>
    Effect.forEach(
      subscribers,
      (subscriber) =>
        Effect.flatMap(Effect.exit(Effect.suspend(() => subscriber(event))), (exit) =>
          Exit.isFailure(exit)
            ? Effect.logError('a regrouped-folders subscriber failed', { groupId: event.groupId, cause: Cause.pretty(exit.cause) })
            : Effect.void,
        ),
      { discard: true },
    );

  const follow = (groupId: number, projects: readonly number[]) => {
    let refiled: readonly ThreadId[] = [];
    let receivers: readonly number[] = [];
    return regroup(groupId).pipe(
      Effect.tap((done) =>
        Effect.sync(() => {
          refiled = done.refiled;
          receivers = done.receivers;
        }),
      ),
      Effect.asVoid,
      Effect.ensuring(Effect.suspend(() => announce({ groupId, projects: [...new Set([...projects, ...receivers])], refiled }))),
    );
  };

  const standing = Effect.fn('ThreadFolders.standing')(function* () {
    const held = yield* groups.list();
    for (const group of held) yield* follow(group.graph.id, [group.graph.id, ...group.members.map((member) => member.id)]);
    const live = new Set(held.map((group) => group.graph.id));
    const owners = yield* units.read((unit) =>
      unit.run(db.selectDistinct({ ownerId: threadFolder.projectId }).from(threadFolder).where(isNotNull(threadFolder.memberId))),
    );
    for (const { ownerId } of owners) if (!live.has(ownerId)) yield* follow(ownerId, [ownerId]);
  });

  const settled = (work: Effect.Effect<void, StoreFailure>, groupId: number | null) =>
    Effect.flatMap(Effect.exit(work), (exit) =>
      Exit.isFailure(exit)
        ? Effect.logError('folders did not follow a group change; the next start settles them', {
            groupId,
            cause: Cause.pretty(exit.cause),
          })
        : Effect.void,
    );
  const detach = changes.grouped.subscribe((change) =>
    settled(follow(change.groupId, [change.groupId, ...change.before, ...change.after]), change.groupId),
  );
  yield* Effect.addFinalizer(() => Effect.sync(detach));
  yield* Effect.forkScoped(settled(standing(), null));

  return ThreadFolders.of({
    list: (projectId) => Effect.flatMap(ownerOf(projectId), (owner) => units.read((unit) => foldersOf(db, unit, owner.id))),

    regrouped: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },

    create: Effect.fn('ThreadFolders.create')((projectId, name, parentId, threadIds) =>
      owned(projectId, 'create', (unit, owner) =>
        Effect.gen(function* () {
          const standing = yield* foldersOf(db, unit, owner.id);
          if (parentId !== null && !standing.some((folder) => folder.id === parentId)) return { status: 'no-parent' as const };
          const members = yield* rootsIn(db, unit, owner.homes, threadIds);
          if (members.missing.length > 0) return { status: 'missing' as const, missing: members.missing };
          const position = childrenOf(standing, parentId).reduce((next, sibling) => Math.max(next, sibling.position + 1), 0);
          const [folder] = yield* unit.run(
            db
              .insert(threadFolder)
              .values({ projectId: owner.id, memberId: owner.member, parentId, name, position })
              .returning(folderColumns),
          );
          if (folder === undefined) return yield* Effect.die(new Error('a folder insert answered no row'));
          return { status: 'created' as const, folder, moved: yield* assign(db, unit, members.roots, folder.id) };
        }),
      ),
    ),

    rename: (projectId, folderId, name) =>
      owned(projectId, 'rename', (unit, owner) =>
        Effect.map(
          unit.run(
            db
              .update(threadFolder)
              .set({ name })
              .where(and(eq(threadFolder.id, folderId), eq(threadFolder.projectId, owner.id)))
              .returning(folderColumns),
          ),
          (rows) => rows[0],
        ),
      ),

    move: Effect.fn('ThreadFolders.move')((projectId, folderId, parentId, index) =>
      owned(projectId, 'move', (unit, owner): Effect.Effect<FolderMoved, StoreFailure> =>
        Effect.gen(function* () {
          const standing = yield* foldersOf(db, unit, owner.id);
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
      owned(projectId, 'remove', (unit, owner) =>
        Effect.gen(function* () {
          const standing = yield* foldersOf(db, unit, owner.id);
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
      owned(projectId, 'file', (unit, owner): Effect.Effect<Filing, StoreFailure> =>
        Effect.gen(function* () {
          if (folderId !== null && (yield* folderIn(db, unit, owner.id, folderId)) === undefined) return { status: 'no-folder' };
          const members = yield* rootsIn(db, unit, owner.homes, threadIds);
          if (members.missing.length > 0) return { status: 'missing', missing: members.missing };
          return { status: 'filed', roots: members.roots, moved: yield* assign(db, unit, members.roots, folderId) };
        }),
      ),
    ),
  });
});

export const threadFoldersLayer = Layer.effect(ThreadFolders, makeThreadFolders);
