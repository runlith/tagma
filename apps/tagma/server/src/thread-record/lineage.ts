import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { Unit } from '../platform/contract/service/units.js';
import { threadRecord } from './store/table.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';

export const subtreeOf = (threadId: string | SQLiteColumn): SQL => sql`(
  with recursive subtree(id) as (
    select ${threadId}
    union all
    select t.id from ${threadRecord} t join subtree s on t.parent_id = s.id
  )
  select id from subtree
)`;

export const liveRootOf = (threadId: string | SQLiteColumn): SQL => sql`(
  with recursive climb(id, parent, depth) as (
    select t.id, t.parent_id, 0 from ${threadRecord} t where t.id = ${threadId}
    union all
    select p.id, p.parent_id, c.depth + 1
      from ${threadRecord} p
      join climb c on c.parent = p.id
     where p.archived_at is null
  )
  select id from climb order by depth desc limit 1
)`;

export const lineageOf = (threadId: string): SQL => sql`(
  with recursive lineage(id, parent) as (
    select t.id, t.parent_id from ${threadRecord} t where t.id = ${threadId}
    union all
    select p.id, p.parent_id from ${threadRecord} p join lineage l on l.parent = p.id
  )
  select id from lineage
)`;

const within = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, set: SQL) =>
  Effect.map(
    unit.run(
      db
        .select({ id: threadRecord.id })
        .from(threadRecord)
        .where(and(eq(threadRecord.id, id), sql`${threadRecord.id} in ${set}`))
        .get(),
    ),
    (row) => row !== undefined,
  );

export const relationOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, callerId: string) =>
  Effect.flatMap(within(db, unit, id, lineageOf(callerId)), (own) =>
    own
      ? Effect.succeed('lineage' as const)
      : Effect.map(within(db, unit, id, subtreeOf(callerId)), (below) => (below ? ('subtree' as const) : ('beyond' as const))),
  );

export const isDescendant = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, ancestorId: string) =>
  Effect.map(
    unit.run(
      db
        .select({ id: threadRecord.id })
        .from(threadRecord)
        .where(and(eq(threadRecord.id, id), sql`${threadRecord.id} != ${ancestorId}`, sql`${threadRecord.id} in ${subtreeOf(ancestorId)}`))
        .get(),
    ),
    (row) => row !== undefined,
  );

export const subtree = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, excludingLineage?: string | null) =>
  Effect.map(
    unit.run(
      db
        .select({ id: threadRecord.id })
        .from(threadRecord)
        .where(
          and(
            sql`${threadRecord.id} in ${subtreeOf(id)}`,
            excludingLineage == null ? undefined : sql`${threadRecord.id} not in ${lineageOf(excludingLineage)}`,
          ),
        ),
    ),
    (rows) => rows.map((row) => row.id as ThreadId),
  );
