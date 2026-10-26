import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Clock, Effect, Schema } from 'effect';
import { BaselineNotReached, MigrationChainInvalid } from '../contract/service/store.js';
import type { Migration } from './chain.js';

export const baselineObjects = `select type, name, tbl_name as owner, sql from sqlite_master
where sql is not null and name not glob 'sqlite_*' and name != '__drizzle_migrations'
and name not in (select name from pragma_table_list where type = 'shadow')
order by type collate binary, name collate binary`;

export type SchemaObject = { readonly type: string; readonly name: string; readonly owner: string; readonly sql: string };

export const schemaDigest = (objects: readonly SchemaObject[], retiredTables: readonly string[] = []): string => {
  const retired = new Set(retiredTables);
  return createHash('sha256')
    .update(JSON.stringify(objects.filter(({ owner }) => !retired.has(owner))))
    .digest('hex');
};

const receiptSchema = Schema.Struct({
  migration: Schema.String,
  release: Schema.String,
  schema: Schema.String,
  retiredTables: Schema.Array(Schema.String),
  chain: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String, folderMillis: Schema.Number })),
  tail: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String, folderMillis: Schema.Number, schema: Schema.String })),
});

export type BaselineReceipt = typeof receiptSchema.Type;

export const baselineReceipt = Effect.fnUntraced(function* (folder: string) {
  const text = yield* Effect.tryPromise({
    try: () =>
      readFile(join(folder, 'baseline.json'), 'utf8').catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === 'ENOENT') return null;
        throw cause;
      }),
    catch: (cause) => new MigrationChainInvalid({ folder, disagreements: [`baseline receipt cannot be read: ${String(cause)}`] }),
  });
  if (text === null) return null;
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(receiptSchema))(text).pipe(
    Effect.mapError((cause) => new MigrationChainInvalid({ folder, disagreements: [`baseline receipt is unreadable: ${cause.message}`] })),
  );
});

export type AppliedMigration = { readonly name: string | null; readonly hash: string };

type FoldedCut = { readonly migration: Migration; readonly following: readonly AppliedMigration[] };

const foldedCut = Effect.fn('Store.foldedCut')(function* (
  db: EffectSQLiteBunDatabase,
  local: readonly Migration[],
  folder: string,
  receipt: BaselineReceipt,
  applied: readonly AppliedMigration[],
) {
  const migration = local.find((candidate) => candidate.name === receipt.migration);
  if (migration === undefined)
    return yield* new MigrationChainInvalid({
      folder,
      disagreements: [`${receipt.migration}: baseline receipt names an absent migration`],
    });
  if (applied.some((row) => row.name === receipt.migration) || applied.length === 0) return null;
  const expectedChain = [...receipt.chain, ...receipt.tail];
  if (applied.length > expectedChain.length)
    return yield* new MigrationChainInvalid({
      folder,
      disagreements: [`${applied.length} rows exceed the ${expectedChain.length} migrations covered by the baseline receipt`],
    });
  const disagreements: string[] = [];
  const recorded = new Set(applied.map(({ name }) => name));
  if (receipt.chain.some(({ name }) => !recorded.has(name))) {
    const shipped = new Map(expectedChain.map(({ name, hash }) => [name, hash]));
    const seen = new Set<string | null>();
    for (const [offset, row] of applied.entries()) {
      if (row.name === null || shipped.get(row.name) !== row.hash || seen.has(row.name))
        disagreements.push(`row ${offset + 1}: ${row.name} (${row.hash}) is not a unique member of the baseline chain`);
      seen.add(row.name);
    }
    if (disagreements.length > 0) return yield* new MigrationChainInvalid({ folder, disagreements });
    return yield* new BaselineNotReached({ folder, applied: applied.length, cut: receipt.chain.length, release: receipt.release });
  }
  for (let start = 0; start < applied.length;) {
    let end = start + 1;
    while (end < expectedChain.length && expectedChain[end]!.folderMillis === expectedChain[start]!.folderMillis) end++;
    const group = expectedChain.slice(start, end);
    const actual = applied.slice(start, end);
    const members = new Map(group.map(({ name, hash }) => [name, hash]));
    const seen = new Set<string | null>();
    for (const [offset, row] of actual.entries()) {
      if (row.name === null || members.get(row.name) !== row.hash || seen.has(row.name))
        disagreements.push(
          `row ${start + offset + 1}: ${row.name} (${row.hash}) is not a unique member of the expected migration-time group`,
        );
      seen.add(row.name);
      if (actual.length < group.length && (row.name !== group[offset]!.name || row.hash !== group[offset]!.hash))
        disagreements.push(`row ${start + offset + 1}: the partial migration-time group has no schema fingerprint in the receipt`);
    }
    start = end;
  }
  if (disagreements.length > 0) return yield* new MigrationChainInvalid({ folder, disagreements });
  const objects = yield* db.all<SchemaObject>(sql.raw(baselineObjects));
  const tail = applied.length - receipt.chain.length;
  const expectedSchema = tail === 0 ? receipt.schema : receipt.tail[tail - 1]!.schema;
  if (schemaDigest(objects, receipt.retiredTables) !== expectedSchema)
    return yield* new MigrationChainInvalid({
      folder,
      disagreements: ['the schema differs from the baseline and its applied following migrations'],
    });
  return { migration, following: applied.slice(receipt.chain.length) } satisfies FoldedCut;
});

export const baselineLedger = Effect.fn('Store.baselineLedger')(function* (
  db: EffectSQLiteBunDatabase,
  local: readonly Migration[],
  folder: string,
  applied: readonly AppliedMigration[],
) {
  const receipt = yield* baselineReceipt(folder);
  if (receipt === null) return null;
  const cut = yield* foldedCut(db, local, folder, receipt, applied);
  return cut === null ? null : [{ name: cut.migration.name, hash: cut.migration.hash }, ...cut.following];
});

export const translateBaseline = Effect.fn('Store.translateBaseline')(function* <E, R>(
  db: EffectSQLiteBunDatabase,
  local: readonly Migration[],
  folder: string,
  retire: (migrations: readonly string[]) => Effect.Effect<void, E, R>,
) {
  const receipt = yield* baselineReceipt(folder);
  if (receipt === null) return false;
  const columns = yield* db.all<{ name: string }>(sql`select name from pragma_table_info('__drizzle_migrations')`);
  if (!columns.some((column) => column.name === 'name')) return false;
  const eligible = Effect.gen(function* () {
    const applied = yield* db.all<AppliedMigration>(sql`select name, hash from __drizzle_migrations order by created_at, id`);
    return yield* foldedCut(db, local, folder, receipt, applied);
  });
  const translated =
    (yield* eligible) === null
      ? false
      : yield* db.transaction(() =>
          Effect.gen(function* () {
            const cut = yield* eligible;
            if (cut === null)
              return yield* new MigrationChainInvalid({
                folder,
                disagreements: ['the ledger changed before the baseline translation committed'],
              });
            yield* db.run(
              sql`delete from __drizzle_migrations where name in (${sql.join(
                receipt.chain.map(({ name }) => sql`${name}`),
                sql`, `,
              )})`,
            );
            const migration = cut.migration;
            yield* db.run(sql`insert into __drizzle_migrations (hash, created_at, name, applied_at)
      values (${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${new Date(yield* Clock.currentTimeMillis).toISOString()})`);
            return true;
          }),
        );
  yield* retire(receipt.chain.map(({ name }) => name));
  return translated;
});
