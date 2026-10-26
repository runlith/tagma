import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Effect } from 'effect';
import { SnapshotFailed } from '../contract/service/snapshots.js';

export type SnapshotTable = {
  readonly name: string;
  readonly definition: string | null;
  readonly columns: readonly string[];
  readonly rowid: string | null;
  readonly savedRowid: string | null;
  readonly data: boolean;
  readonly added: readonly string[];
  readonly sequence: string | null;
  readonly renamed?: string | undefined;
};

export type SnapshotObject = {
  readonly type: 'index' | 'trigger' | 'view';
  readonly name: string;
  readonly definition: string | null;
};

const toFailed = (path: string, cause: unknown): SnapshotFailed => {
  if (cause instanceof SnapshotFailed) return cause;
  if (cause instanceof Error) return new SnapshotFailed({ path, reason: cause.message });
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof (cause as { readonly message: unknown }).message === 'string'
  ) {
    return new SnapshotFailed({ path, reason: (cause as { readonly message: string }).message });
  }
  return new SnapshotFailed({ path, reason: String(cause) });
};

export const copyTables = Effect.fnUntraced(function* (db: EffectSQLiteBunDatabase, tables: readonly SnapshotTable[]) {
  const wanted = tables.filter((table) => table.data);
  if (wanted.length === 0) return;
  for (const table of wanted) {
    const hasRowid = table.rowid !== null && table.savedRowid !== null;
    if (table.columns.length === 0 && !hasRowid) continue;
    const target = sql.identifier(table.name);
    const plain = table.columns.map((column) => sql.identifier(column));
    const shaped = hasRowid ? [...plain, sql`${sql.identifier(table.rowid!)} as ${sql.identifier(table.savedRowid!)}`] : plain;
    yield* db
      .run(sql`create table snapshot.${target} as select ${sql.join(shaped, sql`, `)} from main.${target} where 0`)
      .pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
    const fetched = hasRowid ? [...plain, sql.identifier(table.rowid!)] : plain;
    yield* db
      .run(sql`insert into snapshot.${target} select ${sql.join(fetched, sql`, `)} from main.${target}`)
      .pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
  }
});

export const restoreTables = Effect.fnUntraced(function* (
  db: EffectSQLiteBunDatabase,
  tables: readonly SnapshotTable[],
  objects: readonly SnapshotObject[],
  rebuilt: readonly string[],
) {
  for (const object of objects) {
    const found = yield* db
      .all<{ readonly type: string }>(sql`select type from main.sqlite_master where name = ${object.name}`)
      .pipe(Effect.mapError((cause) => toFailed(object.name, cause)));
    if (found.length === 0) continue;
    const actual = found.find((row) => row.type === object.type)?.type ?? found[0]!.type;
    if (actual !== object.type) {
      return yield* new SnapshotFailed({ path: object.name, reason: `expected ${object.type} but main holds ${actual}` });
    }
    const target = sql.identifier(object.name);
    if (object.type === 'index') {
      yield* db.run(sql`drop index main.${target}`).pipe(Effect.mapError((cause) => toFailed(object.name, cause)));
    } else if (object.type === 'trigger') {
      yield* db.run(sql`drop trigger main.${target}`).pipe(Effect.mapError((cause) => toFailed(object.name, cause)));
    } else {
      yield* db.run(sql`drop view main.${target}`).pipe(Effect.mapError((cause) => toFailed(object.name, cause)));
    }
  }
  const renamed = tables.filter((table) => table.renamed !== undefined);
  if (renamed.length > 0)
    yield* db.run(sql`PRAGMA legacy_alter_table = ON`).pipe(Effect.mapError((cause) => toFailed('legacy_alter_table', cause)));
  for (const table of renamed) {
    const standing = yield* db
      .all<{ readonly name: string }>(sql`select name from pragma_table_xinfo(${table.renamed}) where hidden = 0`)
      .pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
    const shape = (names: readonly string[]) => names.map((name) => name.toLowerCase()).join('\u0000');
    if (standing.length === 0 || shape(standing.map((column) => column.name)) !== shape(table.columns)) {
      return yield* new SnapshotFailed({
        path: table.name,
        reason: `${table.renamed} no longer stands with the columns ${table.name} was renamed with; it cannot be renamed back`,
      });
    }
    yield* db
      .run(sql`alter table main.${sql.identifier(table.renamed!)} rename to ${sql.identifier(table.name)}`)
      .pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
  }
  for (const table of tables) {
    const target = sql.identifier(table.name);
    if (table.definition === null) {
      yield* db.run(sql`drop table if exists main.${target}`).pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
    } else if (table.data) {
      yield* db.run(sql`drop table if exists main.${target}`).pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
    }
  }
  for (const table of tables) {
    if (table.definition === null || !table.data) continue;
    yield* db.run(sql.raw(table.definition)).pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
  }
  for (const table of tables) {
    if (table.definition === null || !table.data) continue;
    const hasRowid = table.rowid !== null && table.savedRowid !== null;
    if (table.columns.length === 0 && !hasRowid) continue;
    const target = sql.identifier(table.name);
    const into = [...table.columns.map((column) => sql.identifier(column)), ...(hasRowid ? [sql.identifier(table.rowid!)] : [])];
    const from = [...table.columns.map((column) => sql.identifier(column)), ...(hasRowid ? [sql.identifier(table.savedRowid!)] : [])];
    yield* db
      .run(sql`insert into main.${target} (${sql.join(into, sql`, `)}) select ${sql.join(from, sql`, `)} from snapshot.${target}`)
      .pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
  }
  for (const table of tables) {
    if (!table.data || table.definition === null || table.sequence === null) continue;
    if (!/^-?\d+$/.test(table.sequence)) {
      return yield* new SnapshotFailed({ path: table.name, reason: 'snapshot sequence is not an integer' });
    }
    const catalog = sql.identifier('sqlite_sequence');
    const nameColumn = sql.identifier('name');
    const seqColumn = sql.identifier('seq');
    yield* db
      .run(sql`delete from main.${catalog} where ${nameColumn} = ${table.name}`)
      .pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
    yield* db
      .run(sql`insert into main.${catalog} (${nameColumn}, ${seqColumn}) values (${table.name}, cast(${table.sequence} as integer))`)
      .pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
  }
  for (const table of tables) {
    if (table.data || table.definition === null || table.added.length === 0) continue;
    const standing = new Map(
      (yield* db
        .all<{ readonly name: string }>(sql`select name from pragma_table_xinfo(${table.name})`)
        .pipe(Effect.mapError((cause) => toFailed(table.name, cause)))).map((row) => [row.name.toLowerCase(), row.name] as const),
    );
    if (standing.size === 0 || !table.columns.every((column) => standing.has(column.toLowerCase()))) {
      return yield* new SnapshotFailed({
        path: table.name,
        reason: 'the schema-only snapshot has no row copy for this changed table shape',
      });
    }
    const doomed = table.added.flatMap((column) => standing.get(column.toLowerCase()) ?? []).reverse();
    for (const column of doomed) {
      yield* db
        .run(sql`alter table main.${sql.identifier(table.name)} drop column ${sql.identifier(column)}`)
        .pipe(Effect.mapError((cause) => toFailed(table.name, cause)));
    }
  }
  for (const object of objects) {
    if (object.definition === null) continue;
    yield* db.run(sql.raw(object.definition)).pipe(Effect.mapError((cause) => toFailed(object.name, cause)));
  }
  for (const name of rebuilt) {
    const target = sql.identifier(name);
    yield* db.run(sql`insert into main.${target} (${target}) values ('rebuild')`).pipe(Effect.mapError((cause) => toFailed(name, cause)));
  }
});
