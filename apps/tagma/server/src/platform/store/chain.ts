import { realpathSync } from 'node:fs';
import { Clock, Effect } from 'effect';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import type { SqlError } from 'effect/sql/SqlError';
import { sql } from 'drizzle-orm';
import type { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import {
  type MigrationChain,
  BaselineNotReached,
  MigrationChainInvalid,
  MigrationStatementUnresolved,
  type SchemaState,
  type StoreBrand,
} from '../contract/service/store.js';
import { captureKeys, checkKeys, foreignKeys, type KeyScan } from './keyCheck.js';
import { rebuiltBy, removesKey, type ForeignKey } from './keyPlan.js';
import { schemaStatement, statementTarget, type StatementWrite } from './statementTarget.js';
import { reachedWrites, readWriteConsequences, type Consequences } from './writes.js';
import { baselineLedger, type AppliedMigration } from './baseline.js';

export type Migration = ReturnType<typeof readMigrationFiles>[number];

type ChainFolder = Pick<MigrationChain<StoreBrand>, 'folder'>;

const chainFiles = new Map<string, ReturnType<typeof readMigrationFiles>>();

export function chain(migrations: ChainFolder): ReturnType<typeof readMigrationFiles> {
  const folder = realpathSync(migrations.folder);
  const read = chainFiles.get(folder) ?? readMigrationFiles({ migrationsFolder: folder });
  chainFiles.set(folder, read);
  return read;
}

export const shippedChain = (migrations: ChainFolder): SchemaState => {
  const names = chain(migrations)
    .map((migration) => migration.name)
    .sort();
  return { applied: names.length, latest: names[names.length - 1] ?? null };
};

export const pendingMigrations = Effect.fn('Store.pendingMigrations')(function* (
  db: EffectSQLiteBunDatabase,
  local: ReadonlyArray<Migration>,
  folder: string,
): Effect.fn.Return<ReadonlyArray<Migration>, MigrationChainInvalid | BaselineNotReached | SqlError | EffectDrizzleQueryError> {
  const ledger = yield* db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`,
  );
  if (ledger.length === 0) return local;
  const columns = yield* db.all<{ name: string }>(sql`select name from pragma_table_info('__drizzle_migrations')`);
  const named = columns.some((column) => column.name === 'name');
  if (!named) return yield* new MigrationChainInvalid({ folder, disagreements: ['the migration ledger has no names'] });
  const applied = yield* db.all<AppliedMigration>(sql`select name, hash from __drizzle_migrations order by created_at, id`);
  const folded = yield* baselineLedger(db, local, folder, applied);
  const byName = new Map(local.map((migration) => [migration.name, migration]));
  const done = new Set<string>();
  const disagreements = (folded ?? applied).flatMap((row) => {
    if (row.name === null) return ['an applied migration has no name'];
    if (done.has(row.name)) return [`${row.name}: recorded more than once`];
    done.add(row.name);
    const expected = byName.get(row.name);
    if (expected === undefined) return [`${row.name}: applied here, absent from the shipped chain`];
    return expected.hash === row.hash ? [] : [`${row.name}: applied from different text`];
  });
  if (disagreements.length > 0) return yield* new MigrationChainInvalid({ disagreements, folder });
  return local.filter((migration) => !done.has(migration.name));
});

type SchemaReading = {
  readonly tables: ReadonlyMap<string, string>;
  readonly references: ReadonlyMap<number, { readonly table: string; readonly keys: ReadonlyMap<number, string> }>;
  readonly changes: number;
  readonly ledger: number;
};

export const schemaReading = Effect.fn('Store.schemaReading')(function* (
  db: EffectSQLiteBunDatabase,
): Effect.fn.Return<SchemaReading, SqlError | EffectDrizzleQueryError> {
  const entries = yield* db.all<{ type: string; name: string; table: string; rootpage: number; sql: string | null }>(
    sql`select type, name, tbl_name as "table", rootpage, sql from sqlite_master where type in ('table', 'index')`,
  );
  const keys = yield* db.all<{ table: string; rootpage: number; id: number; key: string }>(
    sql`select m.name as "table", m.rootpage, f.id, f.seq || ':' || f."table" || ':' || f."from" || ':' || coalesce(f."to", '') || ':' || f.on_update || ':' || f.on_delete || ':' || f."match" as key from sqlite_master m join pragma_foreign_key_list(m.name) f where m.type = 'table' order by m.name, f.id, f.seq`,
  );
  const changes = yield* db.all<{ n: number }>(sql`select total_changes() as n`);
  const ledger = entries.some((entry) => entry.type === 'table' && entry.name === '__drizzle_migrations')
    ? yield* db.all<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`)
    : [{ n: 0 }];
  const shapes = new Map<string, string>();
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    shapes.set(entry.table, `${shapes.get(entry.table) ?? ''}|${entry.type}:${entry.name}:${entry.rootpage}:${entry.sql ?? ''}`);
  }
  const references = new Map<number, { table: string; keys: Map<number, string> }>();
  for (const { table, rootpage, id, key } of keys) {
    const reference = references.get(rootpage) ?? { table, keys: new Map<number, string>() };
    reference.keys.set(id, `${reference.keys.get(id) ?? ''}|${key}`);
    references.set(rootpage, reference);
  }
  return {
    tables: shapes,
    references,
    changes: changes[0]?.n ?? 0,
    ledger: ledger[0]?.n ?? 0,
  };
});

export const reached = (
  before: SchemaReading,
  after: SchemaReading,
): { readonly touched: ReadonlySet<string>; readonly rekeyed: ReadonlyMap<string, ReadonlySet<number>>; readonly moved: number } => {
  const touched = new Set<string>();
  for (const [name, shape] of after.tables) if (before.tables.get(name) !== shape) touched.add(name);
  for (const name of before.tables.keys()) if (!after.tables.has(name)) touched.add(name);
  const rekeyed = new Map<string, ReadonlySet<number>>();
  for (const [rootpage, reference] of after.references) {
    const standing = new Set(before.references.get(rootpage)?.keys.values());
    const changed = new Set([...reference.keys].filter(([, key]) => !standing.has(key)).map(([id]) => id));
    if (changed.size > 0) rekeyed.set(reference.table.toLowerCase(), changed);
  }
  return { touched, rekeyed, moved: after.changes - before.changes - (after.ledger - before.ledger) };
};

export const resolveMigration = Effect.fnUntraced(function* (migration: Migration) {
  const statements = [...migration.sql];
  for (const statement of statements) {
    const target = statementTarget(statement);
    if (target.kind === 'write' || (target.kind === 'other' && target.temporary)) continue;
    const schema = schemaStatement(statement);
    if (schema.kind === 'unresolved') return yield* new MigrationStatementUnresolved({ migration: migration.name, statement });
    if (schema.kind === 'create-trigger') statements.push(...schema.body);
  }
});

type Failure = SqlError | EffectDrizzleQueryError;

export type MigrationChecked = { readonly scans: readonly KeyScan[] };

export const applyMigration = (
  db: EffectSQLiteBunDatabase,
  migration: Migration,
): Effect.Effect<MigrationChecked, Failure | MigrationStatementUnresolved> =>
  db.transaction(() =>
    Effect.gen(function* () {
      yield* resolveMigration(migration);
      const before = yield* schemaReading(db);
      const existed = new Set([...before.tables.keys()].map((name) => name.toLowerCase()));
      const rebuilt = rebuiltBy(migration.sql);
      let keys: readonly ForeignKey[] | undefined = rebuilt.size > 0 ? yield* foreignKeys(db) : undefined;
      let effects: Consequences | undefined;
      let captures = yield* captureKeys(
        db,
        (keys ?? []).filter((key) => rebuilt.has(key.parent.toLowerCase()) && existed.has(key.parent.toLowerCase())),
      );
      const written = new Map<string, StatementWrite[]>();
      const added = new Map<string, string[]>();
      let changedSchema = false;
      for (const statement of migration.sql) {
        const target = statementTarget(statement);
        if (target.kind === 'write') {
          if (changedSchema || keys === undefined) keys = yield* foreignKeys(db);
          if (changedSchema || effects === undefined) effects = yield* readWriteConsequences(db);
          changedSchema = false;
          const reach = reachedWrites(effects, target);
          if (reach.kind === 'unresolved')
            return yield* new MigrationStatementUnresolved({ migration: migration.name, statement: reach.statement });
          const writes = reach.writes;
          for (const write of writes) {
            const listed = written.get(write.table) ?? [];
            listed.push(write);
            written.set(write.table, listed);
          }
          captures = yield* captureKeys(
            db,
            keys.filter((key) => writes.some((write) => removesKey(write, key))),
            captures,
          );
        } else {
          const schema = schemaStatement(statement);
          if (schema.kind === 'alter-table' && !schema.temporary) {
            if (schema.addedColumn !== null) {
              const columns = added.get(schema.table) ?? [];
              columns.push(schema.addedColumn);
              added.set(schema.table, columns);
            }
            if (schema.renameTo !== null) {
              const writes = written.get(schema.table);
              const columns = added.get(schema.table);
              if (writes !== undefined) {
                written.delete(schema.table);
                written.set(schema.renameTo, writes);
              }
              if (columns !== undefined) {
                added.delete(schema.table);
                added.set(schema.renameTo, columns);
              }
            }
          }
          if (['create-table', 'drop-table', 'alter-table', 'create-trigger', 'drop-trigger'].includes(schema.kind)) changedSchema = true;
        }
        yield* db.run(sql.raw(statement));
      }

      const reach = reached(before, yield* schemaReading(db));
      const checked = yield* checkKeys(db, captures, {
        existed,
        touched: reach.touched,
        rekeyed: reach.rekeyed,
        restored: new Set(),
        added: [...added].flatMap(([table, columns]) => columns.map((column) => ({ table, column }))),
        written: [...written].flatMap(([table, writes]) => writes.map((write) => ({ ...write, table }))),
        moved: reach.moved,
        keys:
          written.size === 0 && captures.length === 0 && reach.touched.size === 0
            ? []
            : changedSchema || keys === undefined
              ? yield* foreignKeys(db)
              : keys,
      });
      const { dangling, scans } = checked;
      if (dangling.length > 0) {
        return yield* Effect.die(
          `migration ${migration.name} left ${dangling.length} dangling references: ${JSON.stringify(dangling.slice(0, 5))}`,
        );
      }
      yield* db.run(
        sql`insert into "__drizzle_migrations" ("hash", "created_at", "name", "applied_at") values (${migration.hash}, ${migration.folderMillis}, ${migration.name ?? null}, ${new Date(yield* Clock.currentTimeMillis).toISOString()})`,
      );
      return { scans };
    }),
  );

export const schemaState = Effect.fn('Store.schemaState')(function* (
  db: EffectSQLiteBunDatabase,
): Effect.fn.Return<SchemaState, SqlError | EffectDrizzleQueryError> {
  const [state] = yield* db.all<SchemaState>(sql`select count(*) as applied, max(name) as latest from __drizzle_migrations`);
  return state!;
});
