import { type Stats, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { readFile, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { OwnGitFailed } from '../../platform/git/ownGit.js';
import { block } from '../store/tables.js';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { changedDirectories, flushDirectories, flushDirectoriesSync, stagingOf, writeAtomic, writeAtomicSync } from './atomicFile.js';
import { BlockTreeUnreadable, shelfNames } from './layout.js';
import { type ConnectionRows, type ExportBlockRow, ExportFailed, rowText } from './export.js';
import { connectionRows, connectionsOf } from './connections.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { ShadowGit } from './shadow.js';
import { askOnce } from './oneShot.js';
import type { Tags } from '../contract/service/vocabulary.js';
import { writes } from '../../platform/contract/service/writes.js';

const IDENTITY_FILE = '.identity.json';

const projectingTree = writes('Tree.project', [block]);

const PARKING = '.moving-';

const parked = (relative: string): boolean => relative.split('/').some((part) => part.startsWith(PARKING));

const parkingOf = (dir: string, uuid: string): string => `${dir}${PARKING}${uuid}`;

const placeOf = (path: string): string => (path.endsWith('/index.md') ? dirname(path) : path);

const under = (dir: string) => sql`instr(${block.path}, ${`${dir}/`}) = 1`;

const dirOf = (path: string): string => (dirname(path) === '.' ? '' : `${dirname(path)}/`);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const io = <A>(path: string, run: () => Promise<A>): Effect.Effect<A, BlockTreeUnreadable> =>
  Effect.tryPromise({ try: run, catch: (error) => new BlockTreeUnreadable({ reason: 'io', path, message: messageOf(error) }) });

const unlessGone = <A>(read: Promise<A>): Promise<A | null> =>
  read.catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });

const statOf = (abs: string): Effect.Effect<Stats | null, BlockTreeUnreadable> => io(abs, () => unlessGone(stat(abs)));

const textOf = (abs: string): Effect.Effect<string | null, BlockTreeUnreadable> => io(abs, () => unlessGone(readFile(abs, 'utf8')));

const emptyDir = (abs: string, found: Stats): Effect.Effect<boolean, BlockTreeUnreadable> =>
  found.isDirectory() ? io(abs, async () => (await readdir(abs)).length === 0) : Effect.succeed(false);

const readIdentity = (treeRoot: string): Effect.Effect<Map<number, string>, BlockTreeUnreadable> => {
  const path = join(treeRoot, IDENTITY_FILE);
  return Effect.tryPromise({
    try: async () => {
      const text = await unlessGone(readFile(path, 'utf8'));
      if (text === null) return new Map<number, string>();
      const parsed = JSON.parse(text) as Record<string, string>;
      return new Map(Object.entries(parsed).map(([id, uuid]) => [Number(id), uuid]));
    },
    catch: (error) => new BlockTreeUnreadable({ reason: 'file', path, message: messageOf(error) }),
  });
};

export type ProjectionJob = {
  readonly treeRoot: string;
  readonly blocks: readonly (ExportBlockRow & { readonly path: string | null })[];
  readonly connections: ConnectionRows;
};

type Projected = {
  readonly written: number;
  readonly removed: number;
  readonly moved: readonly { readonly id: number; readonly path: string | null }[];
};

export type ProjectionAnswer =
  | ({ readonly state: 'projected' } & Projected)
  | {
      readonly state: 'failed';
      readonly failure:
        | { readonly _tag: 'ExportFailed'; readonly message: string }
        | {
            readonly _tag: 'BlockTreeUnreadable';
            readonly reason: BlockTreeUnreadable['reason'];
            readonly path: string;
            readonly message: string;
          };
    };

const renderFiles = (job: ProjectionJob): Effect.Effect<Projected, ExportFailed | BlockTreeUnreadable> =>
  askOnce<ProjectionAnswer, BlockTreeUnreadable>(
    new URL('./projection.worker.ts', import.meta.url),
    job,
    (message) => new BlockTreeUnreadable({ reason: 'io', path: job.treeRoot, message }),
  ).pipe(
    Effect.flatMap((answer): Effect.Effect<Projected, ExportFailed | BlockTreeUnreadable> => {
      if (answer.state === 'projected') return Effect.succeed({ written: answer.written, removed: answer.removed, moved: answer.moved });
      if (answer.failure._tag === 'ExportFailed') return Effect.fail(new ExportFailed({ message: answer.failure.message }));
      const { reason, path, message } = answer.failure;
      return Effect.fail(new BlockTreeUnreadable({ reason, path, message }));
    }),
  );

export type GraphProjection = {
  readonly blocks: number;
  readonly written: number;
  readonly removed: number;
};

export const projectToTree = Effect.fn('Graph.projectToTree')(function* (input: {
  readonly projectId: number;
  readonly treeRoot: string;
}): Effect.fn.Return<GraphProjection, StoreFailure | ExportFailed | BlockTreeUnreadable, GraphStore | Tags> {
  const store = yield* GraphStore;
  const { db } = store;
  const rows = yield* db
    .select({
      id: block.id,
      uuid: block.uuid,
      parentId: block.parentId,
      ord: block.ord,
      tags: block.tags,
      fields: block.fields,
      title: block.title,
      body: block.body,
      deletedAt: block.deletedAt,
      path: block.path,
    })
    .from(block)
    .where(eq(block.projectId, input.projectId));
  const sidecar = yield* readIdentity(input.treeRoot);
  const minted = new Map<number, string>();
  const blocks: ProjectionJob['blocks'][number][] = [];
  const dropped: { readonly id: number; readonly path: null }[] = [];
  for (const row of rows) {
    if (row.deletedAt !== null) {
      if (row.path !== null) dropped.push({ id: row.id, path: null });
      continue;
    }
    let uuid = row.uuid;
    if (uuid === null) {
      uuid = sidecar.get(row.id) ?? mintBlockId();
      minted.set(row.id, uuid);
    }
    blocks.push({ ...row, uuid });
  }
  if (minted.size > 0) {
    yield* store.transaction(projectingTree, () =>
      Effect.forEach(minted, ([id, uuid]) => db.update(block).set({ uuid }).where(eq(block.id, id)), { discard: true }),
    );
  }
  const connections = yield* connectionRows(input.projectId, blocks, 'alive');
  const identity = join(input.treeRoot, IDENTITY_FILE);
  const { projected, moved } = yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const projected = yield* renderFiles({ treeRoot: input.treeRoot, blocks, connections });
      yield* io(identity, () => rm(identity, { force: true }));
      const moved = [...projected.moved, ...dropped];
      if (moved.length > 0) {
        yield* store.transaction(projectingTree, () =>
          Effect.forEach(moved, ({ id, path }) => db.update(block).set({ path }).where(eq(block.id, id)), { discard: true }),
        );
      }
      return { projected, moved };
    }),
  );
  yield* Effect.annotateCurrentSpan({
    projectId: input.projectId,
    blocks: blocks.length,
    written: projected.written,
    removed: projected.removed,
    moved: moved.length,
  });
  return { blocks: blocks.length, written: projected.written, removed: projected.removed };
});

export type GraphFileSyncAnswer = {
  readonly blocks: number;
  readonly commit: string | null;
};

export const syncProject = Effect.fnUntraced(function* (input: {
  readonly projectId: number;
  readonly treeRoot: string;
  readonly shadow: ShadowGit;
  readonly message: string;
  readonly author?: string;
}): Effect.fn.Return<GraphFileSyncAnswer, StoreFailure | ExportFailed | BlockTreeUnreadable | OwnGitFailed, GraphStore | Tags> {
  if ((yield* statOf(join(input.treeRoot, '.git'))) !== null) {
    const unmerged = yield* input.shadow.unmergedPaths(input.treeRoot);
    if (unmerged.length > 0) {
      return yield* new OwnGitFailed({
        op: 'sync',
        message: `the tree stands mid-merge with ${unmerged.length} unmerged path(s); resolve them first`,
        ran: true,
      });
    }
  }
  const projection = yield* projectToTree(input);
  const commit = yield* input.shadow.commitAct(input.treeRoot, input.message, input.author);
  return { blocks: projection.blocks, commit };
});

export type DeltaProjection = {
  readonly written: number;
  readonly moved: number;
  readonly removed: number;
};

export type TouchedPath = (relative: string, staged: boolean, restorable: boolean) => void;

export const projectDelta = Effect.fnUntraced(function* (input: {
  readonly projectId: number;
  readonly treeRoot: string;
  readonly blockIds: readonly number[];
  readonly touched?: TouchedPath;
}): Effect.fn.Return<DeltaProjection, StoreFailure | ExportFailed | BlockTreeUnreadable, GraphStore | Tags> {
  if (input.blockIds.length === 0) return { written: 0, moved: 0, removed: 0 };
  const { db } = yield* GraphStore;
  const named = yield* db
    .select()
    .from(block)
    .where(and(eq(block.projectId, input.projectId), inArray(block.id, [...new Set(input.blockIds)])));
  if (named.length === 0) return { written: 0, moved: 0, removed: 0 };
  let written = 0;
  let moved = 0;
  let removed = 0;
  const touch = (relative: string, staged: boolean): void => {
    if (input.touched === undefined) return;
    input.touched(relative, staged, true);
    const parent = dirname(relative);
    if (parent !== '.') input.touched(parent, false, false);
  };
  const shelfKeys = new Set<number | null>();
  for (const row of named) shelfKeys.add(row.deletedAt === null ? row.parentId : row.parentId);
  const parentColumns = { id: block.id, parentId: block.parentId, path: block.path, deletedAt: block.deletedAt };
  const parentRowOf = new Map<number, { id: number; parentId: number | null; path: string | null; deletedAt: Date | null }>();
  const loadRow = Effect.fn(function* (id: number) {
    const held = parentRowOf.get(id);
    if (held) return held;
    const row = yield* db.select(parentColumns).from(block).where(eq(block.id, id)).get();
    if (row) parentRowOf.set(id, row);
    return row;
  });
  const ordered: (number | null)[] = [];
  const queued = new Set<string>();
  for (const key of shelfKeys) {
    const chain: (number | null)[] = [];
    let cursor: number | null = key;
    while (true) {
      const tag = cursor === null ? 'root' : String(cursor);
      if (queued.has(tag)) break;
      queued.add(tag);
      chain.unshift(cursor);
      if (cursor === null) break;
      const parent = yield* loadRow(cursor);
      if (parent === undefined || parent.deletedAt !== null || parent.path !== null) break;
      cursor = parent.parentId;
    }
    ordered.push(...chain);
  }
  const renamed = new Set<string>();
  const makeDir = (place: string): void => {
    const abs = join(input.treeRoot, place);
    for (const directory of changedDirectories(abs, mkdirSync(abs, { recursive: true }))) renamed.add(directory);
  };
  const movePlace = (from: string, to: string): void => {
    const source = join(input.treeRoot, from);
    if (!existsSync(source)) return;
    const created = !existsSync(dirname(join(input.treeRoot, to)));
    const made = mkdirSync(dirname(join(input.treeRoot, to)), { recursive: true });
    renameSync(source, join(input.treeRoot, to));
    renamed.add(dirname(source));
    for (const directory of changedDirectories(dirname(join(input.treeRoot, to)), made)) renamed.add(directory);
    touch(from, !parked(from));
    touch(to, !parked(to));
    if (created) touch(dirname(to), false);
  };
  const pending = new Set(ordered);
  const requeue = (key: number | null): void => {
    if (pending.has(key)) return;
    pending.add(key);
    ordered.push(key);
  };
  const pathOf = Effect.fn(function* (id: number) {
    return (yield* db.select({ path: block.path }).from(block).where(eq(block.id, id)).get())?.path ?? null;
  });
  const relocate = Effect.fn(function* (from: string, to: string, leaf: number | null) {
    if (from === to) return;
    movePlace(from, to);
    if (leaf !== null) {
      yield* db.update(block).set({ path: to }).where(eq(block.id, leaf));
      return;
    }
    yield* db.run(
      sql`update block set path = ${to} || substr(path, length(${from}) + 1)
            where project_id = ${input.projectId} and ${under(from)}`,
    );
  });
  const evacuate = Effect.fn(function* (dir: string) {
    while (true) {
      const stray = yield* db
        .select({ id: block.id, uuid: block.uuid, parentId: block.parentId, path: block.path })
        .from(block)
        .where(and(eq(block.projectId, input.projectId), isNull(block.deletedAt), under(dir)))
        .orderBy(sql`length(${block.path})`)
        .get();
      if (stray === undefined || stray.path === null || stray.uuid === null) return;
      const leaf = stray.path.endsWith('/index.md') ? null : stray.id;
      yield* relocate(placeOf(stray.path), parkingOf(dirOf(dir), stray.uuid), leaf);
      requeue(stray.parentId);
    }
  });
  const discard = Effect.fn(function* (place: string, dir: boolean) {
    if (dir) yield* evacuate(place);
    rmSync(join(input.treeRoot, place), { recursive: true, force: true });
    touch(place, !parked(place));
    yield* db
      .update(block)
      .set({ path: null })
      .where(and(eq(block.projectId, input.projectId), or(eq(block.path, place), under(place))));
  });
  const holderOf = (place: string) =>
    db
      .select({ id: block.id, uuid: block.uuid, parentId: block.parentId, path: block.path, deletedAt: block.deletedAt })
      .from(block)
      .where(and(eq(block.projectId, input.projectId), or(eq(block.path, place), eq(block.path, `${place}/index.md`))))
      .get();
  const bareDir = (abs: string): boolean => statSync(abs).isDirectory() && readdirSync(abs).length === 0;
  const refuseStray = (place: string) =>
    Effect.fail(new ExportFailed({ message: `${place} stands in the tree, but no block of the graph holds it` }));
  const admit = Effect.fn(function* (place: string) {
    const abs = join(input.treeRoot, place);
    if (!existsSync(abs) || bareDir(abs) || (yield* holderOf(place)) !== undefined) return;
    return yield* refuseStray(place);
  });
  const vacate = Effect.fn(function* (place: string) {
    const abs = join(input.treeRoot, place);
    if (!existsSync(abs)) return;
    const holder = yield* holderOf(place);
    if (holder === undefined || holder.uuid === null || holder.path === null) {
      if (!bareDir(abs)) return yield* refuseStray(place);
      rmdirSync(abs);
      return;
    }
    if (holder.deletedAt !== null) return yield* discard(place, holder.path !== place);
    yield* relocate(place, parkingOf(dirOf(place), holder.uuid), holder.path === place ? holder.id : null);
    requeue(holder.parentId);
  });
  for (const row of named) {
    if (row.deletedAt === null || row.path === null) continue;
    yield* discard(placeOf(row.path), row.path.endsWith('/index.md'));
    (row as { path: string | null }).path = null;
    removed += 1;
  }
  for (let at = 0; at < ordered.length; at += 1) {
    const key = ordered[at] as number | null;
    pending.delete(key);
    const members = yield* db
      .select({ id: block.id, uuid: block.uuid, title: block.title, ord: block.ord, path: block.path })
      .from(block)
      .where(
        and(eq(block.projectId, input.projectId), key === null ? isNull(block.parentId) : eq(block.parentId, key), isNull(block.deletedAt)),
      );
    if (members.length === 0) continue;
    let parentDir = '';
    if (key !== null) {
      const parent = yield* db.select(parentColumns).from(block).where(eq(block.id, key)).get();
      if (parent === undefined || parent.path === null) {
        return yield* Effect.fail(new ExportFailed({ message: `shelf parent ${key} has no projected path` }));
      }
      if (!parent.path.endsWith('/index.md')) {
        const dir = parent.path.slice(0, -'.md'.length);
        const indexPath = `${dir}/index.md`;
        yield* vacate(dir);
        makeDir(dir);
        touch(dir, false);
        yield* relocate(parent.path, indexPath, parent.id);
        (parent as { path: string | null }).path = indexPath;
        moved += 1;
      }
      parentDir = `${dirname(parent.path)}/`;
      if (parentDir === './') parentDir = '';
    }
    const childCounts = new Map<number, number>(
      (yield* db
        .select({ parentId: block.parentId, count: sql<number>`count(*)` })
        .from(block)
        .where(
          and(
            inArray(
              block.parentId,
              members.map((m) => m.id),
            ),
            isNull(block.deletedAt),
          ),
        )
        .groupBy(block.parentId)).map((row) => [row.parentId as number, row.count]),
    );
    const names = shelfNames(members.map((m) => ({ id: m.uuid as string, title: m.title, ord: m.ord })));
    const moving = members.flatMap((member) => {
      const name = names.get(member.uuid as string) as string;
      const isDir = (childCounts.get(member.id) ?? 0) > 0;
      const desired = isDir ? `${parentDir}${name}/index.md` : `${parentDir}${name}.md`;
      return member.path === desired ? [] : [{ id: member.id, uuid: member.uuid as string, isDir, desired }];
    });
    for (const { desired, isDir } of moving) yield* admit(isDir ? dirname(desired) : desired);
    for (const { id, uuid } of moving) {
      const path = yield* pathOf(id);
      if (path === null) continue;
      yield* relocate(placeOf(path), parkingOf(parentDir, uuid), path.endsWith('/index.md') ? null : id);
    }
    for (const { id, isDir, desired } of moving) {
      const path = yield* pathOf(id);
      if (path === desired) continue;
      yield* vacate(isDir ? dirname(desired) : desired);
      if (path === null) {
        yield* db.update(block).set({ path: desired }).where(eq(block.id, id));
        continue;
      }
      const from = placeOf(path);
      const wasDir = path.endsWith('/index.md');
      if (wasDir === isDir) {
        yield* relocate(from, placeOf(desired), isDir ? null : id);
      } else if (isDir) {
        makeDir(dirname(desired));
        touch(dirname(desired), false);
        yield* relocate(from, desired, id);
      } else {
        yield* relocate(path, desired, id);
        yield* discard(from, true);
      }
      moved += 1;
    }
  }
  const alive = named.filter((row) => row.deletedAt === null);
  const settled =
    alive.length === 0
      ? []
      : yield* db
          .select({ id: block.id, path: block.path })
          .from(block)
          .where(
            inArray(
              block.id,
              alive.map((row) => row.id),
            ),
          );
  for (const [path, text] of yield* encodedFiles(input.projectId, alive, new Map(settled.map((row) => [row.id, row.path])))) {
    const abs = join(input.treeRoot, path);
    if (existsSync(abs) && readFileSync(abs, 'utf8') === text) continue;
    const staging = stagingOf(path);
    for (const directory of writeAtomicSync(abs, join(input.treeRoot, staging), text)) renamed.add(directory);
    input.touched?.(staging, false, false);
    touch(path, true);
    written += 1;
  }
  flushDirectoriesSync([...renamed].filter((dir) => existsSync(dir)));
  return { written, moved, removed };
});

type ProjectedRow = typeof block.$inferSelect;

const encodedFiles = Effect.fnUntraced(function* (
  projectId: number,
  rows: readonly ProjectedRow[],
  paths: ReadonlyMap<number, string | null>,
) {
  const files = new Map<string, string>();
  if (rows.length === 0) return files;
  const connections = yield* connectionsOf(projectId, rows);
  for (const row of rows) {
    const path = paths.get(row.id) ?? null;
    if (row.uuid === null || path === null) continue;
    files.set(path, rowText({ ...row, uuid: row.uuid }, connections));
  }
  return files;
});

export const restorePaths = Effect.fnUntraced(function* (input: {
  readonly projectId: number;
  readonly treeRoot: string;
  readonly paths: readonly string[];
}) {
  const places = [...new Set(input.paths)].filter((path) => path !== '' && path !== '.');
  if (places.length === 0) return 0;
  const { db } = yield* GraphStore;
  const rows = yield* db
    .select()
    .from(block)
    .where(
      and(
        eq(block.projectId, input.projectId),
        isNull(block.deletedAt),
        or(...places.flatMap((place) => [eq(block.path, place), under(place)])),
      ),
    );
  const target = yield* encodedFiles(input.projectId, rows, new Map(rows.map((row) => [row.id, row.path])));
  let restored = 0;
  const standing: string[] = [];
  const walk = Effect.fnUntraced(function* (relative: string): Effect.fn.Return<void, BlockTreeUnreadable> {
    const abs = join(input.treeRoot, relative);
    const found = yield* statOf(abs);
    if (found === null) return;
    if (found.isDirectory()) {
      for (const entry of yield* io(abs, () => readdir(abs))) {
        if (!entry.startsWith('.')) yield* walk(`${relative}/${entry}`);
      }
    } else if (relative.endsWith('.md')) standing.push(relative);
  });
  for (const place of places) {
    if (!parked(place)) {
      yield* walk(place);
      continue;
    }
    const abs = join(input.treeRoot, place);
    if ((yield* statOf(abs)) === null) continue;
    yield* io(abs, () => rm(abs, { recursive: true, force: true }));
    restored += 1;
  }
  for (const relative of new Set(standing)) {
    if (target.has(relative)) continue;
    const abs = join(input.treeRoot, relative);
    yield* io(abs, () => rm(abs, { force: true }));
    restored += 1;
  }
  const written = new Set<string>();
  for (const [relative, text] of target) {
    const abs = join(input.treeRoot, relative);
    if ((yield* textOf(abs)) === text) continue;
    for (const directory of yield* io(abs, () => writeAtomic(abs, stagingOf(abs), text))) written.add(directory);
    restored += 1;
  }
  yield* io(input.treeRoot, () => flushDirectories(written));
  for (const place of [...places].sort((a, b) => b.length - a.length)) {
    const abs = join(input.treeRoot, place);
    const found = yield* statOf(abs);
    if (found !== null && (yield* emptyDir(abs, found))) yield* io(abs, () => rmdir(abs));
  }
  return restored;
}, Effect.uninterruptible);
