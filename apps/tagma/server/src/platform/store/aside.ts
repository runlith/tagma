import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Data, Deferred, Effect, Schema } from 'effect';
import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { type Adopting, IN_MEMORY, SetAsideFailed, type Store, type StoreBrand } from '../contract/service/store.js';
import { setAsidePath } from '../contract/service/ownStore.js';
import { watched } from '../contract/service/drives.js';
import { type DurableWriteFailed, makeDirectory, moveFile, removeFile } from '../durable/files.js';

const DECLARATION = 'aside.json';

const Declared = Schema.fromJsonString(Schema.Struct({ tables: Schema.NonEmptyArray(Schema.NonEmptyString) }));

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const unwritten = (failure: DurableWriteFailed) => new SetAsideFailed({ path: failure.path, reason: failure.reason });

const declaredTables = Effect.fn('Store.setAside.declared')(function* (folder: string, migration: string) {
  const file = join(folder, migration, DECLARATION);
  const text = yield* Effect.tryPromise({
    try: () =>
      readFile(file, 'utf8').catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === 'ENOENT') return null;
        throw cause;
      }),
    catch: (cause) => new SetAsideFailed({ path: file, reason: String(cause) }),
  });
  if (text === null) return null;
  const declared = yield* Schema.decodeUnknownEffect(Declared)(text).pipe(
    Effect.mapError((cause) => new SetAsideFailed({ path: file, reason: String(cause) })),
  );
  return declared.tables;
});

export const setAside = Effect.fn('Store.setAside')(function* (
  db: EffectSQLiteBunDatabase,
  path: string,
  folder: string,
  migration: string,
) {
  const tables = yield* declaredTables(folder, migration);
  if (tables === null || path === IN_MEMORY) return;
  const target = setAsidePath(path, migration);
  const writing = `${target}.writing`;
  yield* makeDirectory(dirname(target)).pipe(Effect.mapError(unwritten));
  for (const left of [writing, `${writing}-journal`]) yield* removeFile(left).pipe(Effect.mapError(unwritten));
  yield* db.run(sql`ATTACH DATABASE ${writing} AS aside`);
  yield* db
    .transaction(() =>
      Effect.forEach(tables, (table) => db.run(sql.raw(`CREATE TABLE aside.${quoted(table)} AS SELECT * FROM main.${quoted(table)}`)), {
        discard: true,
      }),
    )
    .pipe(Effect.ensuring(Effect.orDie(db.run(sql`DETACH DATABASE aside`))));
  yield* moveFile(writing, target).pipe(Effect.mapError(unwritten));
  console.log(`[tagma] migration ${migration}: ${tables.join(', ')} set aside with their rows at ${target}`);
});

class SetAsideRefused extends Data.TaggedError('SetAsideRefused')<{
  readonly path: string;
  readonly table: string;
  readonly reason: 'no-table' | 'keyless' | 'key-missing' | 'key-empty';
}> {
  override get message(): string {
    const why = {
      'no-table': 'this store has no table of that name',
      keyless: 'its table here has no primary key',
      'key-missing': 'the set-aside lacks a column of its primary key here',
      'key-empty': 'a set-aside row has no value in its primary key here',
    }[this.reason];
    return `the set-aside at ${this.path} is not adopted: ${this.table}: ${why}, so its rows could not be taken exactly once`;
  }
}

type Adoption = { readonly outcome: 'absent' } | { readonly outcome: 'adopted'; readonly rows: number };

type Planned = { readonly table: string; readonly columns: string; readonly key: string };

let attachments = 0;

const planned = Effect.fnUntraced(function* (db: EffectSQLiteBunDatabase, file: string, alias: string, table: string) {
  const refused = (reason: SetAsideRefused['reason']) => new SetAsideRefused({ path: file, table, reason });
  const target = yield* db.all<{ name: string; pk: number }>(sql`select name, pk from pragma_table_info(${table}, 'main')`);
  if (target.length === 0) return yield* refused('no-table');
  const key = target.filter((column) => column.pk > 0).toSorted((a, b) => a.pk - b.pk);
  if (key.length === 0) return yield* refused('keyless');
  const source = new Set(
    (yield* db.all<{ name: string }>(sql`select name from pragma_table_info(${table}, ${alias})`)).map((column) => column.name),
  );
  if (key.some((column) => !source.has(column.name))) return yield* refused('key-missing');
  const empty = key.map((column) => `${quoted(column.name)} is null`).join(' or ');
  const [unkeyed] = yield* db.all<{ n: number }>(sql.raw(`select count(*) as n from ${quoted(alias)}.${quoted(table)} where ${empty}`));
  if ((unkeyed?.n ?? 0) > 0) return yield* refused('key-empty');
  return {
    table,
    columns: [...source].map(quoted).join(', '),
    key: key.map((column) => quoted(column.name)).join(', '),
  } satisfies Planned;
});

const adoptFile = Effect.fn('Store.adopt')(function* (
  db: EffectSQLiteBunDatabase,
  transaction: Store<StoreBrand>['transaction'],
  file: string,
) {
  if (!existsSync(file)) return { outcome: 'absent' } satisfies Adoption;
  const alias = `aside_${++attachments}`;
  yield* db.run(sql`ATTACH DATABASE ${file} AS ${sql.identifier(alias)}`);
  const rows = yield* Effect.gen(function* () {
    const tables = yield* db.all<{ name: string }>(
      sql.raw(`select name from ${quoted(alias)}.sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`),
    );
    const plans = yield* Effect.forEach(tables, ({ name }) => planned(db, file, alias, name));
    return yield* transaction('store.adopt', () =>
      Effect.gen(function* () {
        yield* db.run(sql`PRAGMA defer_foreign_keys = ON`);
        let inserted = 0;
        for (const { table, columns, key } of plans) {
          yield* db.run(
            sql.raw(
              `INSERT INTO main.${quoted(table)} (${columns}) SELECT ${columns} FROM ${quoted(alias)}.${quoted(table)} WHERE true ON CONFLICT (${key}) DO NOTHING`,
            ),
          );
          inserted += (yield* db.all<{ n: number }>(sql`select changes() as n`))[0]?.n ?? 0;
        }
        return inserted;
      }),
    );
  }).pipe(Effect.ensuring(Effect.orDie(db.run(sql.raw(`DETACH DATABASE ${quoted(alias)}`)))));
  yield* removeFile(file).pipe(Effect.mapError(unwritten));
  return { outcome: 'adopted', rows } satisfies Adoption;
});

export const adopting = Effect.fnUntraced(function* (
  db: EffectSQLiteBunDatabase,
  transaction: Store<StoreBrand>['transaction'],
  plan: Adopting | undefined,
) {
  if (plan === undefined || plan.files.length === 0) return Effect.void;
  const ended = yield* Deferred.make<void>();
  const adopt = (file: string) =>
    watched(
      `store.adopt ${file}`,
      Effect.tap(adoptFile(db, transaction, file), (adopted) =>
        Effect.sync(() => {
          if (adopted.outcome === 'adopted') console.log(`[tagma] ${file}: ${adopted.rows} rows adopted`);
        }),
      ),
    );
  yield* Effect.forkScoped(
    Effect.andThen(
      plan.after,
      Effect.forEach(plan.files, (file) => Effect.exit(adopt(file)), { discard: true }),
    ).pipe(Effect.ensuring(Deferred.succeed(ended, undefined))),
  );
  return Deferred.await(ended);
});
