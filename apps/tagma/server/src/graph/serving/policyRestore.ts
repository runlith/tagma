import { Effect } from 'effect';
import { sql } from 'drizzle-orm';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';

export type RestoredPolicy = {
  readonly id: number;
  readonly strictProvenance?: boolean;
  readonly private?: boolean;
  readonly storage: string;
};

export const restorePolicies = Effect.fnUntraced(function* (
  unit: WriteUnit<'machine'>,
  db: StoreDb<'machine'>,
  rows: readonly RestoredPolicy[],
): Effect.fn.Return<void, StoreFailure> {
  if (rows.length === 0) return;
  const split = yield* unit.run(db.all<{ found: number }>(sql`select count(*) as found from pragma_table_info('project_policy')`));
  if ((split[0]?.found ?? 0) > 0) {
    for (const row of rows) {
      yield* unit.run(
        db.run(sql`insert into project_policy (project_id, strict_provenance, private, storage)
        values (${row.id}, ${row.strictProvenance ? 1 : 0}, ${row.private ? 1 : 0}, ${row.storage})`),
      );
    }
    return;
  }
  for (const row of rows) {
    yield* unit.run(
      db.run(
        sql`update project set strict_provenance = ${row.strictProvenance ? 1 : 0}, private = ${row.private ? 1 : 0}, storage = ${row.storage} where id = ${row.id}`,
      ),
    );
  }
});
