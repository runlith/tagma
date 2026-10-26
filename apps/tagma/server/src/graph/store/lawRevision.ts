import { Effect } from 'effect';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { block, meta } from './tables.js';
import { carriesTag } from '../vocabulary/projection.js';
import { vocabularyRevisionKey } from '../contract/wire/storage.js';

const keyOf = (projectId: number) => `law-revision:${projectId}`;

export const vocabularyRevision = (db: StoreDb<'graph'>, projectId: number) =>
  db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, vocabularyRevisionKey(projectId)))
    .get()
    .pipe(Effect.map((row) => row?.value ?? '0'));

export const advanceVocabulary = (db: StoreDb<'graph'>, projectId: number) =>
  db
    .insert(meta)
    .values({ key: vocabularyRevisionKey(projectId), value: '1' })
    .onConflictDoUpdate({
      target: meta.key,
      set: { value: sql<string>`CAST(${meta.value} AS INTEGER) + 1` },
    });

export const lawRevision = (db: StoreDb<'graph'>, projectId: number) =>
  db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, keyOf(projectId)))
    .get()
    .pipe(Effect.map((row) => row?.value ?? '0'));

export const advanceLaw = (db: StoreDb<'graph'>, projectId: number) =>
  db
    .insert(meta)
    .values({ key: keyOf(projectId), value: '1' })
    .onConflictDoUpdate({
      target: meta.key,
      set: { value: sql<string>`CAST(${meta.value} AS INTEGER) + 1` },
    });

export const lawShapingTypes = (table: TagTable): readonly string[] => [
  ...table.lawBearingTypes(),
  TAG_DECLARATION.id,
  CATALOG_DECLARATION.id,
];

export const shapesLaw = Effect.fn('Law.shapes')(function* (
  db: StoreDb<'graph'>,
  table: TagTable,
  projectId: number,
  ids: readonly number[],
) {
  if (ids.length === 0) return false;
  const types = lawShapingTypes(table);
  for (let at = 0; at < ids.length; at += 500) {
    const row = yield* db
      .select({ id: block.id })
      .from(block)
      .where(
        and(
          eq(block.projectId, projectId),
          carriesTag(types, block.id),
          sql`${block.id} in (
        with recursive affected(id) as (
          select ${block.id} from ${block} where ${inArray(block.id, ids.slice(at, at + 500))}
          union
          select b.id from block b join affected a on b.parent_id = a.id
        ) select id from affected
      )`,
        ),
      )
      .limit(1)
      .get();
    if (row !== undefined) return true;
  }
  return false;
});
