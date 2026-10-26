import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { sql } from 'drizzle-orm';
import { SnapshotFailed, type SnapshotStore, type SnapshotMigration, type SnapshotParticipant } from '../contract/service/snapshots.js';
import type { MigrationLoad } from '../contract/wire/migrationLoad.js';
import { snapshotPlan } from './snapshotPlan.js';
import { nameOf, tokenize } from './statementTarget.js';

const Heavy = Schema.Struct({ reason: Schema.NonEmptyString });

export const migrationLoad = Effect.fn('Store.migrationLoad')(
  function* (
    store: SnapshotStore,
    pending: readonly SnapshotMigration[],
    folder: string,
    participants: Readonly<Record<string, SnapshotParticipant>>,
  ) {
    const migrations: { name: string; reason: string }[] = [];
    for (const migration of pending) {
      const file = join(folder, migration.name, 'heavy.json');
      const text = yield* Effect.tryPromise({
        try: () =>
          readFile(file, 'utf8').catch((cause: NodeJS.ErrnoException) => {
            if (cause.code === 'ENOENT') return null;
            throw cause;
          }),
        catch: (cause) => new SnapshotFailed({ path: file, reason: String(cause) }),
      });
      if (text === null) continue;
      const declared = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Heavy))(text).pipe(
        Effect.mapError((cause) => new SnapshotFailed({ path: file, reason: String(cause) })),
      );
      migrations.push({ name: migration.name, reason: declared.reason });
    }
    if (migrations.length === 0) return null;
    const plan = yield* snapshotPlan(store.db, store.path, pending);
    const catalog = yield* store.db.all<{ name: string; wr: number }>(
      sql`select name, wr from pragma_table_list where schema = 'main' and type = 'table'`,
    );
    const named = new Map(catalog.map((table) => [table.name.toLowerCase(), table]));
    const touched = new Set(plan.tables.map((table) => table.name.toLowerCase()));
    for (const migration of pending)
      for (const statement of migration.sql)
        for (const token of tokenize(statement)) {
          const name = nameOf(token)?.toLowerCase();
          if (name !== undefined && named.has(name)) touched.add(name);
        }
    const tables: MigrationLoad['tables'][number][] = [];
    for (const name of touched) {
      const held = named.get(name);
      const snapshot = plan.tables.some((table) => table.name.toLowerCase() === name && table.data);
      if (held === undefined) {
        tables.push({ name, maxRowid: 0, snapshot });
        continue;
      }
      const columns = yield* store.db.all<{ name: string }>(sql`select name from pragma_table_xinfo(${held.name})`);
      const shadowed = new Set(columns.map((column) => column.name.toLowerCase()));
      const rowid = held.wr === 0 ? ['rowid', '_rowid_', 'oid'].find((name) => !shadowed.has(name)) : undefined;
      const bound =
        rowid === undefined
          ? null
          : (yield* store.db.all<{ n: number }>(
              sql`select coalesce(max(${sql.identifier(rowid)}), 0) as n from ${sql.identifier(held.name)}`,
            ))[0]!.n;
      tables.push({ name: held.name, maxRowid: bound, snapshot });
    }
    const files: MigrationLoad['files'][number][] = [];
    const captured = plan.tables.filter((table) => table.data).map((table) => table.name);
    for (const [owner, participant] of Object.entries(participants)) {
      if (!participant.tables.some((table) => captured.includes(table))) continue;
      const estimate =
        participant.estimate === undefined
          ? { bytes: null, hashPasses: null }
          : yield* participant.estimate({ ...store, tables: captured });
      files.push({ owner, ...estimate });
    }
    return { migrations, tables, files };
  },
  (effect, store, pending, folder, participants) =>
    effect.pipe(
      Effect.mapError((cause) =>
        cause instanceof SnapshotFailed ? cause : new SnapshotFailed({ path: store.path, reason: String(cause) }),
      ),
    ),
);
