import { Effect } from 'effect';
import { sql } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { block } from './tables.js';
import { project } from '../../projects/store/table.js';

export const blockOwners = (db: StoreDb<'graph'>) =>
  Effect.map(
    db.all<{ id: number }>(
      sql`select ${project.id} as id from ${project} where exists (select 1 from ${block} where ${block.projectId} = ${project.id})`,
    ),
    (rows) => rows.map((row) => row.id),
  );
