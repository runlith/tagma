import { and, eq, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import type { ThreadRecap } from './contract/wire/recap.js';
import { threadRecord } from './store/table.js';

export const voidRecap = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, id: string, appearedAt: number) =>
  Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set({ recap: sql`json_set(${threadRecord.recap}, '$.voided', json('true'))` })
        .where(
          and(
            eq(threadRecord.id, id),
            sql`json_extract(${threadRecord.recap}, '$.voided') = 0`,
            sql`json_extract(${threadRecord.recap}, '$.basis.position') >= ${appearedAt}`,
          ),
        )
        .returning({ id: threadRecord.id }),
    ),
    (rows) => rows.length > 0,
  );

export const writeRecap = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, id: string, recap: ThreadRecap) =>
  Effect.map(
    unit.run(db.update(threadRecord).set({ recap }).where(eq(threadRecord.id, id)).returning({ id: threadRecord.id })),
    (rows) => rows.length > 0,
  );
