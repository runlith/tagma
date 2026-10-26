import { eq, type SQL, sql } from 'drizzle-orm';
import { QueryBuilder, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../platform/contract/service/store.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import { threadRecord } from '../thread-record/store/table.js';
import { threadRolloutCursor } from './store/journal.js';

export const restStamps = new QueryBuilder()
  .select({ id: threadRecord.id, restedAt: threadRolloutCursor.restedAt })
  .from(threadRecord)
  .leftJoin(threadRolloutCursor, eq(threadRolloutCursor.threadId, threadRecord.id))
  .as('thread_rest');

export const restedAtOf = (id: SQL | SQLiteColumn): SQL<Date | null> =>
  sql<Date | null>`(select ${threadRolloutCursor.restedAt} from ${threadRolloutCursor} where ${threadRolloutCursor.threadId} = ${id})`.mapWith(
    threadRolloutCursor.restedAt,
  );

export const setRested = (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  id: string,
  at: Date | null,
): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(
    unit.run(
      at === null
        ? db.update(threadRolloutCursor).set({ restedAt: null }).where(eq(threadRolloutCursor.threadId, id))
        : db
            .insert(threadRolloutCursor)
            .values({ threadId: id, restedAt: at })
            .onConflictDoUpdate({ target: threadRolloutCursor.threadId, set: { restedAt: at } }),
    ),
  );
