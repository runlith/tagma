import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { type Adoption, IN_MEMORY, SetAsideFailed, SetAsideRefused, type Store, type StoreBrand } from '../contract/service/store.js';
import { setAsidePath } from '../contract/service/ownStore.js';
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

let attachments = 0;

export const adoptSetAside = Effect.fn('Store.adopt')(function* <Brand extends StoreBrand>(
  db: EffectSQLiteBunDatabase,
  transaction: Store<Brand>['transaction'],
  file: string,
) {
  if (!existsSync(file)) return { outcome: 'absent' } satisfies Adoption;
  const alias = `aside_${++attachments}`;
  yield* db.run(sql`ATTACH DATABASE ${file} AS ${sql.identifier(alias)}`);
  const rows = yield* Effect.gen(function* () {
    const tables = yield* db.all<{ name: string }>(
      sql.raw(`select name from ${quoted(alias)}.sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`),
    );
    for (const { name } of tables) {
      const keyed = yield* db.all<{ n: number }>(
        sql`select (select count(*) from pragma_table_info(${name}, 'main') where pk > 0) + (select count(*) from pragma_index_list(${name}, 'main') where "unique" = 1) as n`,
      );
      if ((keyed[0]?.n ?? 0) === 0) return yield* new SetAsideRefused({ path: file, table: name, reason: 'keyless' });
    }
    return yield* transaction('store.adopt', () =>
      Effect.gen(function* () {
        let inserted = 0;
        for (const { name } of tables) {
          const columns = yield* db.all<{ name: string }>(sql`select name from pragma_table_info(${name}, ${alias})`);
          const list = columns.map((column) => quoted(column.name)).join(', ');
          yield* db.run(
            sql.raw(
              `INSERT INTO main.${quoted(name)} (${list}) SELECT ${list} FROM ${quoted(alias)}.${quoted(name)} WHERE true ON CONFLICT DO NOTHING`,
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
