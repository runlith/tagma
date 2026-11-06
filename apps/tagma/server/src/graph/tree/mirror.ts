import { dirname } from 'node:path';
import { Clock, Data, Effect } from 'effect';
import { and, eq, getTableColumns, inArray, isNull, or, sql } from 'drizzle-orm';
import { type StoreDb, GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block, blockTag, edge, farEdge, meta, source, touch, unboundEdge } from '../store/tables.js';
import { ownRoot } from '../acts/far.js';
import { type FarRow, bindUnboundEdges, fileEdges, insertFarRows, insertUnboundRows } from './edgeRows.js';
import type { UnboundEdgeRow } from '../contract/service/blocks.js';
import { pagesOf } from '../../platform/store/binds.js';
import { duplicateIdentity, twiceHeld } from './duplicates.js';
import { type BlockRead, readBlocks } from './blockReads.js';
import { type Fallen, purgeUnjournaled, rebatch, recordTrash } from './fallen.js';
import { type BlockRow, type EdgeRow, type SearchUncounted, type SourceRow, Act, BlockProjection } from '../contract/service/acts.js';
import { assertBodyCap } from '../blocks/guards.js';
import { projectedTags } from '../vocabulary/projection.js';
import { GateRefusal, type FloorRefusal } from '../../platform/contract/wire/refusal.js';
import { bodyCap, validateFields } from '../vocabulary/declarationRules.js';
import { Tags } from '../contract/service/vocabulary.js';
import { mintedAt } from '../contract/wire/identity.js';
import { spokenId } from '../../platform/contract/wire/ids.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import type { BlockFile, BlockFrontmatter } from './blockFile.js';
import type { TreeChange } from './freshness.js';
import type { TreeScan } from './scan.js';
import { type BlockTreeUnreadable, type TreeRoots, fileIn, unmergedRefusal } from './layout.js';
import { inStealth } from '../contract/wire/storage.js';
import { forestPlace, rehangFallen } from './forest.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting, referencing } from '../store/actWrites.js';
import { HOLDER, HOLDER_SLOT } from '../contract/wire/tags/holder.js';
import { advanceLaw, shapesLaw } from '../store/lawRevision.js';
import { importedEnforcement } from './lawChanges.js';
import type { Tagged } from '../contract/wire/tags/roles.js';
import type { WriterRegister } from '../../platform/contract/service/writers.js';
import { readSessions } from './sessions.js';

const rebuilding = writes('Mirror.rebuild', [block, source, edge, farEdge, unboundEdge, touch], projecting, referencing);
const repairing = writes('Mirror.repair', [block, source, edge, farEdge, unboundEdge, touch], projecting, referencing);

const BLOCK_COLUMNS = Object.keys(getTableColumns(block)).length;
const SOURCE_COLUMNS = Object.keys(getTableColumns(source)).length;
const EDGE_COLUMNS = Object.keys(getTableColumns(edge)).length;
const TOUCH_COLUMNS = Object.keys(getTableColumns(touch)).length;
const TAG_COLUMNS = Object.keys(getTableColumns(blockTag)).length;

function holderField(table: TagTable, tags: readonly string[]): string | null {
  return table.bindingTag({ tags }, HOLDER)?.contracts?.[HOLDER]?.slots[HOLDER_SLOT] ?? null;
}

const changedFields = (fields: Readonly<Record<string, unknown>>, front: BlockFrontmatter): boolean =>
  JSON.stringify(fields) !== JSON.stringify(front.fields ?? {});

const EPOCH = new Date(0);

const MIRROR_REVISION = 'tree-mirror-revision';

export const mirrorRevision = Effect.fn('Mirror.revision')(function* () {
  const { db } = yield* GraphStore;
  const row = yield* db.select({ value: meta.value }).from(meta).where(eq(meta.key, MIRROR_REVISION)).get();
  return row?.value ?? '0';
});

const advanceRevision = Effect.fn('Mirror.advanceRevision')(function* () {
  const { db } = yield* GraphStore;
  yield* db
    .insert(meta)
    .values({ key: MIRROR_REVISION, value: '1' })
    .onConflictDoUpdate({
      target: meta.key,
      set: { value: sql<string>`CAST(${meta.value} AS INTEGER) + 1` },
    });
});

export class MirrorRefused extends Data.TaggedError('MirrorRefused')<{
  readonly reason: 'no-root' | 'many-roots' | 'repair';
  readonly message: string;
}> {}

export class MirrorFailed extends Data.TaggedError('MirrorFailed')<{
  readonly message: string;
}> {}

const unreadable = <A, R>(read: Effect.Effect<A, BlockTreeUnreadable, R>): Effect.Effect<A, MirrorFailed, R> =>
  Effect.mapError(read, (failure) => new MirrorFailed({ message: `${failure.path}: ${failure.message}` }));

export type MirrorRebuild = {
  readonly ids: ReadonlyMap<string, number>;
  readonly deadEdges: readonly { readonly fromId: string; readonly to: string }[];
  readonly unreadFields: readonly UnreadField[];
};

export type UnreadField = {
  readonly id: string;
  readonly path: string;
  readonly reason: string;
};

const projectTags = Effect.fn('Mirror.projectTags')(function* (
  db: StoreDb<'graph'>,
  rows: readonly { readonly id: number; readonly tags: readonly string[] }[],
) {
  for (const slice of pagesOf(rows, 1)) {
    yield* db.delete(blockTag).where(
      inArray(
        blockTag.blockId,
        slice.map((row) => row.id),
      ),
    );
    const carried = slice.flatMap((row) => projectedTags(row).map((tag) => ({ blockId: row.id, tag })));
    for (const page of pagesOf(carried, TAG_COLUMNS, (row) => row.tag.length)) yield* db.insert(blockTag).values(page);
  }
});

const absorbedVocabulary = Effect.fn('Mirror.vocabulary')(function* (projectId: number) {
  const vocabulary = yield* Tags;
  yield* vocabulary.forget(projectId);
  return yield* vocabulary.of(projectId);
});

const unreadFieldsOf = Effect.fn('Mirror.unreadFields')(function* (
  table: TagTable,
  id: string,
  path: string,
  node: {
    readonly tags: readonly string[];
    readonly fields: Readonly<Record<string, unknown>>;
    readonly body: { readonly length: number };
  },
) {
  const tags = table.tagsOf(node);
  const reread = yield* Effect.result(validateFields(tags, node.fields));
  if (reread._tag === 'Failure') return [{ id, path, reason: reread.failure.reason }];
  const capped = yield* Effect.result(assertBodyCap(tags, node.body));
  return capped._tag === 'Failure' ? [{ id, path, reason: capped.failure.reason }] : [];
});

export const absorbMirror = Effect.fn('Mirror.absorb')(function* (scan: TreeScan, projectId: number) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const vocabulary = yield* Tags;
  const table = yield* vocabulary.of(projectId);
  const roots = scan.blocks.filter((row) => row.parentId === null);
  if (roots.length === 0) {
    return yield* Effect.fail(new MirrorRefused({ reason: 'no-root', message: 'the tree holds no root block' }));
  }
  if (roots.length > 1) {
    return yield* Effect.fail(
      new MirrorRefused({
        reason: 'many-roots',
        message: `the tree holds ${roots.length} root blocks: ${roots.map((row) => row.frontmatter.id).join(', ')}`,
      }),
    );
  }
  const ordered = [...scan.blocks].sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
  const uuids = ordered.map((row) => row.frontmatter.id);
  const scanned = new Set(uuids);
  if (scanned.size !== uuids.length) {
    return yield* duplicateIdentity(twiceHeld(ordered.map((row) => ({ path: row.path, id: row.frontmatter.id }))));
  }
  const previous = yield* db.select().from(block);
  const previousByUuid = new Map(previous.map((row) => [row.uuid, row]));
  const kept = previous.filter((row) => row.uuid !== null && !scanned.has(row.uuid));
  const keptIds = new Set(kept.map((row) => row.id));
  const newlyFallen = new Set(kept.filter((row) => row.deletedAt === null).map((row) => row.id));
  const keptEdges = keptIds.size === 0 ? [] : (yield* db.select().from(edge)).filter((row) => keptIds.has(row.fromId));
  const keptFar = keptIds.size === 0 ? [] : (yield* db.select().from(farEdge)).filter((row) => keptIds.has(row.fromId));
  const keptUnbound =
    keptIds.size === 0
      ? []
      : (yield* db.select().from(unboundEdge)).filter(
          (row) => keptIds.has(row.fromId) && !(row.kind === 'supersedes' && newlyFallen.has(row.fromId)),
        );
  const rootUuid = roots[0]!.frontmatter.id;
  const keptSources = keptIds.size === 0 ? [] : (yield* db.select().from(source)).filter((row) => keptIds.has(row.blockId));
  const revivedUuids = new Set(
    previous.filter((row) => row.uuid !== null && row.deletedAt !== null && scanned.has(row.uuid)).map((row) => row.uuid as string),
  );
  const uuidByOldId = new Map(previous.filter((row) => row.uuid !== null).map((row) => [row.id, row.uuid as string]));
  const holders = new Map(
    previous.flatMap((row) => {
      const held = table.holderOf(row);
      return row.uuid === null || held === null ? [] : [[row.uuid, held] as const];
    }),
  );
  const heldIds = new Map(previous.filter((row) => row.uuid !== null).map((row) => [row.uuid as string, row.id]));
  const ids = new Map<string, number>();
  let nextId = previous.reduce((high, row) => Math.max(high, row.id), 0);
  for (const uuid of uuids) {
    const held = heldIds.get(uuid);
    if (held === undefined) continue;
    ids.set(uuid, held);
  }
  for (const uuid of uuids) {
    if (ids.has(uuid)) continue;
    nextId += 1;
    ids.set(uuid, nextId);
  }
  for (const row of kept) ids.set(row.uuid as string, row.id);
  const previousTouches = yield* db.select().from(touch);
  const deadEdges: { fromId: string; to: string }[] = [];
  const projection = yield* BlockProjection;
  yield* act.unit(
    rebuilding,
    Effect.gen(function* () {
      yield* projection.discard();
      yield* db.delete(touch);
      yield* db.delete(source);
      yield* db.delete(edge);
      yield* db.delete(farEdge);
      yield* db.delete(unboundEdge);
      yield* db.delete(block);
      const now = new Date(yield* Clock.currentTimeMillis);
      const standing = new Set(ids.values());
      const rootId = ids.get(roots[0]?.frontmatter.id as string) as number;
      const fallen: Fallen[] = [];
      const blocks: BlockRow[] = ordered.map((row) => {
        const front = row.frontmatter;
        const stealth = inStealth(row.path);
        return {
          id: ids.get(front.id) as number,
          uuid: front.id,
          path: row.path,
          projectId,
          stealth,
          parentId: row.parentId === null ? null : scanned.has(row.parentId) ? (ids.get(row.parentId) as number) : stealth ? rootId : null,
          ord: front.ord,
          tags: front.tags ?? [],
          fields: front.fields ?? {},
          title: front.title,
          body: row.body,
          deletedAt: null,
          createdAt: mintedAt(front.id) ?? EPOCH,
          updatedAt: mintedAt(front.id) ?? EPOCH,
        };
      });
      for (const row of kept) {
        const parentId = row.parentId !== null && standing.has(row.parentId) ? row.parentId : rootId;
        blocks.push({ ...row, parentId, path: null, deletedAt: row.deletedAt ?? now });
        if (row.deletedAt === null) fallen.push({ id: row.id, parentId });
      }
      for (const page of pagesOf(blocks, BLOCK_COLUMNS, (row) => row.title.length + row.body.length + JSON.stringify(row.fields).length)) {
        yield* db.insert(block).values(page);
      }
      const succeeded = new Set<number>();
      const sources: SourceRow[] = [];
      const edges: EdgeRow[] = [];
      const farRows: FarRow[] = [...keptFar];
      const unboundRows: UnboundEdgeRow[] = [...keptUnbound];
      for (const row of ordered) {
        const front = row.frontmatter;
        const blockId = ids.get(front.id) as number;
        for (const sourceRow of front.sources ?? []) {
          sources.push({
            id: sources.length + 1,
            blockId,
            kind: sourceRow.kind,
            ref: sourceRow.ref,
            symbol: sourceRow.symbol ?? null,
            createdAt: EPOCH,
          });
        }
        const split = fileEdges(blockId, front.edges ?? [], rootUuid, (uuid) => ids.get(uuid));
        farRows.push(...split.far);
        unboundRows.push(...split.unbound);
        for (const to of split.dead) deadEdges.push({ fromId: front.id, to });
        for (const { kind, toId } of split.near) {
          edges.push({ fromId: blockId, toId, kind, createdBySessionId: null, createdAt: EPOCH });
          if (kind === 'supersedes') succeeded.add(toId);
        }
      }
      for (const row of keptSources) sources.push({ ...row, id: sources.length + 1 });
      for (const row of keptEdges) {
        if (!standing.has(row.toId)) continue;
        if (row.kind === 'supersedes' && (newlyFallen.has(row.fromId) || succeeded.has(row.toId))) continue;
        edges.push(row);
      }
      for (const page of pagesOf(sources, SOURCE_COLUMNS, (row) => row.ref.length + (row.symbol?.length ?? 0))) {
        yield* db.insert(source).values(page);
      }
      for (const page of pagesOf(edges, EDGE_COLUMNS, (row) => row.kind.length)) yield* db.insert(edge).values(page);
      yield* insertFarRows(db, farRows);
      yield* insertUnboundRows(db, unboundRows);
      yield* bindUnboundEdges(db, projectId, uuids);
      yield* recordTrash(act, fallen, now);
      yield* rebatch(
        db,
        act,
        projectId,
        [...revivedUuids].map((uuid) => ids.get(uuid) as number),
        now,
      );
      const touches = previousTouches.flatMap((row) => {
        const taskUuid = uuidByOldId.get(row.taskId);
        const taskId = taskUuid === undefined ? undefined : ids.get(taskUuid);
        return taskId === undefined ? [] : [{ ...row, id: undefined, taskId }];
      });
      for (const page of pagesOf(touches, TOUCH_COLUMNS, (row) => row.place.length)) yield* db.insert(touch).values(page);
      yield* projectTags(
        db,
        ordered.map((row) => ({ id: ids.get(row.frontmatter.id) as number, tags: row.frontmatter.tags ?? [] })),
      );
      const absorbed = yield* absorbedVocabulary(projectId);
      for (const row of ordered) {
        const front = row.frontmatter;
        const id = ids.get(front.id) as number;
        const tags = front.tags ?? [];
        const before = previousByUuid.get(front.id);
        const read = yield* readSessions(absorbed, { tags, fields: front.fields ?? {} }, before?.fields);
        const holder = holders.get(front.id);
        const name = holderField(absorbed, tags);
        const fields = holder === undefined || name === null || read[name] !== undefined ? read : { ...read, [name]: holder };
        if (changedFields(fields, front)) yield* db.update(block).set({ fields }).where(eq(block.id, id));
        yield* importedEnforcement(absorbed, id, before, { tags, fields }, now);
      }
    }),
  );
  return { ids, deadEdges };
});

export const indexMirror = Effect.fn('Mirror.index')(function* (projectId: number) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const projection = yield* BlockProjection;
  const vocabulary = yield* Tags;
  const unreadFields: UnreadField[] = [];
  yield* act.unit(
    rebuilding,
    Effect.gen(function* () {
      yield* purgeUnjournaled(db, projection, projectId);
      const rows = yield* db
        .select({
          id: block.id,
          uuid: block.uuid,
          path: block.path,
          deletedAt: block.deletedAt,
          tags: block.tags,
          fields: block.fields,
          bodyBytes: sql<number>`length(cast(${block.body} as blob))`.mapWith(Number),
        })
        .from(block)
        .where(eq(block.projectId, projectId));
      yield* projection.derive(rows.map((row) => row.id));
      const table = yield* vocabulary.of(projectId);
      const live = rows.filter((row) => row.deletedAt === null);
      const near = live.filter((row) => row.bodyBytes > (bodyCap(table.tagsOf(row))?.cap ?? Number.POSITIVE_INFINITY));
      const bodies = new Map<number, string>();
      for (const page of pagesOf(near, 1, (row) => row.bodyBytes)) {
        const read = yield* db
          .select({ id: block.id, body: block.body })
          .from(block)
          .where(
            inArray(
              block.id,
              page.map((row) => row.id),
            ),
          );
        for (const row of read) bodies.set(row.id, row.body);
      }
      for (const row of live) {
        const body = bodies.get(row.id) ?? { length: row.bodyBytes };
        unreadFields.push(...(yield* unreadFieldsOf(table, row.uuid, row.path ?? '', { ...row, body })));
      }
      yield* advanceLaw(db, projectId);
      yield* advanceRevision();
    }),
  );
  yield* logUnread(unreadFields);
  return unreadFields;
});

export const rebuildMirror = Effect.fnUntraced(function* (
  scan: TreeScan,
  projectId: number,
): Effect.fn.Return<
  MirrorRebuild,
  StoreFailure | SearchUncounted | MirrorRefused | GateRefusal<FloorRefusal | 'duplicate-identity'>,
  GraphStore | Act | BlockProjection | Tags | WriterRegister
> {
  const act = yield* Act;
  return yield* act.unit(
    rebuilding,
    Effect.gen(function* () {
      const absorbed = yield* absorbMirror(scan, projectId);
      return { ...absorbed, unreadFields: yield* indexMirror(projectId) };
    }),
  );
});

const logUnread = (unread: readonly UnreadField[]): Effect.Effect<void> =>
  unread.length === 0
    ? Effect.void
    : Effect.logWarning(
        `${unread.length} node(s) do not read against the tree's own declarations, absorbed as the tree has them: ${unread[0]?.path ?? ''} — ${unread[0]?.reason ?? ''}`,
      );

export type MirrorRepair = {
  readonly upserted: number;
  readonly removed: number;
  readonly deadEdges: readonly { readonly fromId: string; readonly to: string }[];
  readonly unreadFields: readonly UnreadField[];
};

export const repairMirror = Effect.fnUntraced(function* (
  roots: TreeRoots,
  changed: readonly TreeChange[],
  projectId: number,
): Effect.fn.Return<
  MirrorRepair,
  StoreFailure | SearchUncounted | MirrorRefused | MirrorFailed | GateRefusal<FloorRefusal | 'duplicate-identity'>,
  GraphStore | Act | BlockProjection | Tags | WriterRegister
> {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockProjection = yield* BlockProjection;
  const other = changed.filter((change) => !change.path.endsWith('.md'));
  if (other.length > 0) {
    return yield* Effect.fail(
      new MirrorFailed({ message: `${other.length} changed path(s) are not block files: ${other[0]?.path ?? ''}` }),
    );
  }
  const gone = changed.filter((change) => change.status === 'D').map((change) => change.path);
  const arrivals: { path: string; file: BlockFile }[] = [];
  const reads = yield* unreadable(
    readBlocks(
      roots,
      changed.filter((change) => change.status !== 'D').map((change) => change.path),
    ),
  );
  for (const read of reads) {
    if (read.state === 'absent') {
      gone.push(read.path);
      continue;
    }
    if (read.state === 'invalid') {
      if (read.reason === 'conflict-markers') return yield* unmergedRefusal(fileIn(roots, read.path));
      return yield* new MirrorRefused({ reason: 'repair', message: `${read.path}: ${read.message}` });
    }
    arrivals.push({ path: read.path, file: read.file });
  }
  arrivals.sort((a, b) => {
    const depth = a.path.split('/').length - b.path.split('/').length;
    if (depth !== 0) return depth;
    return (a.path.endsWith('/index.md') ? 0 : 1) - (b.path.endsWith('/index.md') ? 0 : 1);
  });
  const arrivalUuids = new Set(arrivals.map((entry) => entry.file.frontmatter.id));
  if (arrivalUuids.size !== arrivals.length) {
    return yield* duplicateIdentity(twiceHeld(arrivals.map((entry) => ({ path: entry.path, id: entry.file.frontmatter.id }))));
  }
  const deadEdges: { fromId: string; to: string }[] = [];
  const unreadFields: UnreadField[] = [];
  let upserted = 0;
  let removed = 0;
  yield* act.unit(
    repairing,
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      const uuidRows = yield* db
        .select({ id: block.id, uuid: block.uuid, path: block.path, deletedAt: block.deletedAt })
        .from(block)
        .where(eq(block.projectId, projectId));
      const revived = uuidRows.filter((row) => row.deletedAt !== null && arrivalUuids.has(row.uuid)).map((row) => row.id);
      const changedPaths = new Set(changed.map((entry) => entry.path));
      const affected = uuidRows
        .filter((row) => (row.path !== null && changedPaths.has(row.path)) || arrivalUuids.has(row.uuid))
        .map((row) => row.id);
      const lawChanged = yield* shapesLaw(db, yield* (yield* Tags).of(projectId), projectId, affected);
      const idByUuid = new Map(uuidRows.filter((row) => row.uuid !== null).map((row) => [row.uuid as string, row.id]));
      const pathByUuid = new Map(uuidRows.filter((row) => row.uuid !== null).map((row) => [row.uuid as string, row.path]));
      const goneSet = new Set(gone);
      const arrivalPaths = new Set(arrivals.map((entry) => entry.path));
      const elsewhere = arrivals.flatMap(({ path, file }) => {
        const held = pathByUuid.get(file.frontmatter.id) ?? null;
        return held === null || held === path || goneSet.has(held) || arrivalPaths.has(held)
          ? []
          : [{ held, path, id: file.frontmatter.id }];
      });
      const standing = yield* unreadable(
        readBlocks(
          roots,
          elsewhere.map((entry) => entry.held),
        ),
      );
      for (const [at, { held, path, id }] of elsewhere.entries()) {
        const read = standing[at] as BlockRead;
        if (read.state === 'absent') continue;
        if (read.state === 'invalid') return yield* new MirrorRefused({ reason: 'repair', message: `${held}: ${read.message}` });
        if (read.file.frontmatter.id !== id) continue;
        return yield* duplicateIdentity([held, path]);
      }
      const trashed: { id: number; parentId: number | null }[] = [];
      const trashBlock = Effect.fn(function* (blockId: number) {
        const row = yield* db
          .update(block)
          .set({ deletedAt: now, path: null })
          .where(eq(block.id, blockId))
          .returning({ id: block.id, parentId: block.parentId })
          .get();
        if (row === undefined) return;
        trashed.push(row);
        yield* db.delete(edge).where(and(eq(edge.fromId, blockId), eq(edge.kind, 'supersedes')));
        yield* db.delete(unboundEdge).where(and(eq(unboundEdge.fromId, blockId), eq(unboundEdge.kind, 'supersedes')));
      });
      for (const path of gone) {
        const row = yield* db
          .select({ id: block.id, uuid: block.uuid })
          .from(block)
          .where(and(eq(block.projectId, projectId), eq(block.path, path), isNull(block.deletedAt)))
          .get();
        if (!row) continue;
        if (row.uuid !== null && arrivalUuids.has(row.uuid)) continue;
        yield* trashBlock(row.id);
        removed += 1;
      }
      const displaced = new Map<string, number[]>();
      for (const { path, file } of arrivals) {
        const standing = yield* db
          .select({ id: block.id, uuid: block.uuid })
          .from(block)
          .where(and(eq(block.projectId, projectId), eq(block.path, path), isNull(block.deletedAt)));
        for (const row of standing) {
          if (row.uuid === file.frontmatter.id || (row.uuid !== null && arrivalUuids.has(row.uuid))) continue;
          yield* trashBlock(row.id);
          displaced.set(path, [...(displaced.get(path) ?? []), row.id]);
          removed += 1;
        }
      }
      yield* blockProjection.forgetVocabulary(trashed.map((row) => row.id));
      yield* recordTrash(act, trashed, now);
      yield* rehangFallen(
        db,
        projectId,
        trashed.map((row) => row.id),
      );
      const landed: { blockId: number; path: string; file: BlockFile; before: Tagged | undefined }[] = [];
      const named: string[] = [];
      for (const { path, file } of arrivals) {
        const front = file.frontmatter;
        const container = path.endsWith('/index.md') ? dirname(dirname(path)) : dirname(path);
        const placed = yield* forestPlace(db, projectId, path, container);
        if (placed.kind === 'loose') {
          return yield* new MirrorRefused({
            reason: 'repair',
            message: `${path} stands in the stealth tree outside any parent's directory`,
          });
        }
        let parentId: number | null = placed.kind === 'top' ? placed.parentId : null;
        if (placed.kind === 'nested' && container !== '.') {
          const parentPath = `${container}/index.md`;
          const parent = yield* db
            .select({ id: block.id })
            .from(block)
            .where(and(eq(block.projectId, projectId), eq(block.path, parentPath)))
            .get();
          if (!parent) {
            return yield* new MirrorRefused({
              reason: 'repair',
              message: `${path} arrived under ${parentPath}, which the mirror does not hold`,
            });
          }
          parentId = parent.id;
        } else if (placed.kind === 'nested') {
          const stranger = yield* db
            .select({ id: block.id })
            .from(block)
            .where(
              and(
                eq(block.projectId, projectId),
                isNull(block.deletedAt),
                sql`${block.parentId} is null`,
                sql`${block.uuid} is not ${front.id}`,
              ),
            )
            .get();
          if (stranger) {
            return yield* Effect.fail(new MirrorRefused({ reason: 'many-roots', message: `${path} arrives as a second root` }));
          }
        }
        const row = {
          uuid: front.id,
          path,
          projectId,
          stealth: inStealth(path),
          parentId,
          ord: front.ord,
          tags: front.tags ?? [],
          fields: front.fields ?? {},
          title: front.title,
          body: file.body,
          deletedAt: null,
        };
        const existing = idByUuid.get(front.id);
        const before =
          existing === undefined
            ? undefined
            : yield* db.select({ tags: block.tags, fields: block.fields }).from(block).where(eq(block.id, existing)).get();
        let blockId: number;
        if (existing !== undefined) {
          yield* db.update(block).set(row).where(eq(block.id, existing));
          blockId = existing;
        } else {
          const born = yield* db
            .insert(block)
            .values({ ...row, createdAt: mintedAt(front.id) ?? EPOCH, updatedAt: mintedAt(front.id) ?? EPOCH })
            .returning({ id: block.id })
            .get();
          if (!born) return yield* Effect.die('block insert returned no row');
          blockId = born.id;
          idByUuid.set(front.id, blockId);
          named.push(spokenId(front.id));
        }
        yield* db.delete(source).where(eq(source.blockId, blockId));
        for (const sourceRow of front.sources ?? []) {
          yield* db.insert(source).values({
            blockId,
            kind: sourceRow.kind,
            ref: sourceRow.ref,
            symbol: sourceRow.symbol ?? null,
            createdAt: EPOCH,
          });
        }
        const orphaned = displaced.get(path);
        if (orphaned !== undefined) {
          yield* db
            .update(block)
            .set({ parentId: blockId })
            .where(and(inArray(block.parentId, orphaned), isNull(block.deletedAt)));
        }
        landed.push({ blockId, path, file, before });
        upserted += 1;
      }
      const root = landed.length === 0 ? null : yield* ownRoot(db, projectId);
      for (const { blockId, file } of landed) {
        const front = file.frontmatter;
        yield* db.delete(edge).where(eq(edge.fromId, blockId));
        yield* db.delete(farEdge).where(eq(farEdge.fromId, blockId));
        yield* db.delete(unboundEdge).where(eq(unboundEdge.fromId, blockId));
        const split = fileEdges(blockId, front.edges ?? [], root, (uuid) => idByUuid.get(uuid));
        for (const to of split.dead) deadEdges.push({ fromId: front.id, to });
        for (const { kind, toId } of split.near) {
          if (kind === 'supersedes') {
            yield* db
              .delete(edge)
              .where(
                and(
                  eq(edge.kind, 'supersedes'),
                  eq(edge.toId, toId),
                  sql`${edge.fromId} in (select id from ${block} where deleted_at is not null)`,
                ),
              );
          }
          yield* db.insert(edge).values({ fromId: blockId, toId, kind, createdBySessionId: null, createdAt: EPOCH });
        }
        yield* insertFarRows(db, split.far);
        yield* insertUnboundRows(db, split.unbound);
      }
      yield* bindUnboundEdges(db, projectId, [...arrivalUuids]);
      yield* blockProjection.derive(landed.map((entry) => entry.blockId));
      const absorbed = yield* (yield* Tags).of(projectId);
      const respelled: number[] = [];
      for (const { blockId, path, file, before } of landed) {
        const front = file.frontmatter;
        const tags = front.tags ?? [];
        const fields = yield* readSessions(absorbed, { tags, fields: front.fields ?? {} }, before?.fields);
        if (changedFields(fields, front)) {
          yield* db.update(block).set({ fields }).where(eq(block.id, blockId));
          respelled.push(blockId);
        }
        yield* importedEnforcement(absorbed, blockId, before, { tags, fields }, now);
        unreadFields.push(...(yield* unreadFieldsOf(absorbed, front.id, path, { tags, fields, body: file.body })));
      }
      yield* blockProjection.derive(respelled);
      if (named.length > 0) {
        const landedIds = new Set(landed.map((entry) => entry.blockId));
        const referrers = yield* db
          .select({ id: block.id })
          .from(block)
          .where(
            and(
              eq(block.projectId, projectId),
              sql`${block.deletedAt} is null`,
              or(...named.map((name) => sql`instr(lower(${block.body}), ${name}) > 0`)),
            ),
          );
        yield* blockProjection.derive(
          referrers.map((row) => row.id).filter((id) => !landedIds.has(id)),
          ['refs'],
        );
      }
      yield* rebatch(db, act, projectId, revived, now);
      if (
        lawChanged ||
        (yield* shapesLaw(
          db,
          absorbed,
          projectId,
          landed.map((entry) => entry.blockId),
        ))
      ) {
        yield* advanceLaw(db, projectId);
      }
      yield* advanceRevision();
    }),
  );
  yield* logUnread(unreadFields);
  return { upserted, removed, deadEdges, unreadFields };
});
