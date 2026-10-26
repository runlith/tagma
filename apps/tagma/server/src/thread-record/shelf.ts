import { and, eq, isNull, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import { threadRecord } from './store/table.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';

export const setArchived = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  roots: readonly string[],
  at: Date | null,
) {
  if (roots.length === 0) return [];
  const family = sql`(
    with recursive family(id, stamp) as (
      select r.value, l.archived_at from json_each(${JSON.stringify(roots)}) r
        join ${threadRecord} l on l.id = r.value
      union
      select t.id, f.stamp from ${threadRecord} t join family f on t.parent_id = f.id
    )
    select id, stamp from family
  )`;
  const rows = yield* unit.run(
    at !== null
      ? db
          .update(threadRecord)
          .set({ archivedAt: at })
          .where(and(sql`${threadRecord.id} in (select id from ${family})`, isNull(threadRecord.archivedAt)))
          .returning({ id: threadRecord.id })
      : db
          .update(threadRecord)
          .set({ archivedAt: null })
          .where(sql`exists (select 1 from ${family} f where f.id = ${threadRecord.id} and f.stamp = ${threadRecord.archivedAt})`)
          .returning({ id: threadRecord.id }),
  );
  return rows.map((row) => row.id as ThreadId);
});

export const setPinned = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, id: string, at: Date | null) =>
  Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set({ pinnedAt: at === null ? null : sql`coalesce(${threadRecord.pinnedAt}, ${at.getTime()})` })
        .where(eq(threadRecord.id, id))
        .returning({ id: threadRecord.id }),
    ),
    (rows) => rows[0]?.id as ThreadId | undefined,
  );

export const advanceReaderOrder = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, id: string, at: Date) {
  const before = yield* unit.run(
    db.select({ archivedAt: threadRecord.archivedAt }).from(threadRecord).where(eq(threadRecord.id, id)).get(),
  );
  yield* unit.run(
    db
      .update(threadRecord)
      .set({ readerOrderAt: sql`max(${threadRecord.readerOrderAt}, ${at.getTime()})`, archivedAt: null })
      .where(
        and(eq(threadRecord.id, id), sql`(${threadRecord.readerOrderAt} < ${at.getTime()} or ${threadRecord.archivedAt} is not null)`),
      ),
  );
  return before?.archivedAt != null;
});
