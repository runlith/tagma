import { and, eq, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import type { HomeMove } from './contract/service/homes.js';
import { threadRecord } from './store/table.js';

export const rehome = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, move: HomeMove, at: Date) =>
  Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set({
          projectId: move.to,
          folderId: null,
          pinnedAt: null,
          readerOrderAt: sql`max(${threadRecord.readerOrderAt}, ${at.getTime()})`,
        })
        .where(and(eq(threadRecord.id, move.threadId), eq(threadRecord.projectId, move.from)))
        .returning({ id: threadRecord.id }),
    ),
    (rows) => rows.length > 0,
  );
