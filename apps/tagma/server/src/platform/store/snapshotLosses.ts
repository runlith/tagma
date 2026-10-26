import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Effect } from 'effect';
import { SnapshotFailed, type SnapshotLoss } from '../contract/service/snapshots.js';
import type { SnapshotTable } from './snapshotCopies.js';

export const snapshotLosses = Effect.fn('Store.snapshotLosses')(
  function* (db: EffectSQLiteBunDatabase, path: string, tables: readonly SnapshotTable[], rows: Readonly<Record<string, number>>) {
    const standing = new Set(
      (yield* db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)).map((row) => row.name),
    );
    const losses: SnapshotLoss[] = [];
    for (const table of tables) {
      if (table.name === '__drizzle_migrations') continue;
      if (!table.data && table.definition !== null) {
        losses.push({
          owner: 'platform',
          table: table.name,
          key: 'schema',
          reason: 'the captured schema is restored while current rows are preserved',
        });
        continue;
      }
      const [current] = standing.has(table.name)
        ? yield* db.all<{ n: number }>(sql`select count(*) as n from main.${sql.identifier(table.name)}`)
        : [{ n: 0 }];
      const before = current?.n ?? 0;
      const restored = rows[table.name] ?? 0;
      const reason =
        table.definition === null
          ? `${before} current rows belong to a table absent from this cut`
          : `${before} current rows are replaced by ${restored} snapshot rows; post-snapshot field changes are not compared`;
      losses.push({ owner: 'platform', table: table.name, key: '*', reason });
    }
    return losses;
  },
  (effect, db, path, tables, rows) => effect.pipe(Effect.mapError((cause) => new SnapshotFailed({ path, reason: cause.message }))),
);
