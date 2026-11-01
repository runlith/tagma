import { Effect } from 'effect';
import { type Column, getTableColumns, getTableName, type SQL, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { StoreBrand, StoreDb, StoreFailure } from '../contract/service/store.js';
import type { Unit, WriteUnit } from '../contract/service/units.js';
import { PROJECTION_CLOCK } from '@runlith/sqlite-process/channel';

type Row = Readonly<Record<string, unknown>>;

export const rowCursor = Effect.fnUntraced(function* <Brand extends StoreBrand>(db: StoreDb<Brand>, unit: Unit<Brand>) {
  const row = yield* unit.run(db.get<{ cursor: number }>(sql`select cursor from ${sql.identifier(PROJECTION_CLOCK)} where id = ''`));
  if (row === undefined) return yield* Effect.die(new Error('A row projection was read before its writer clock was installed.'));
  return row.cursor;
});

//! One bound parameter carries the whole list, so no list length meets SQLite's parameter ceiling.
export const among = (values: readonly string[]): SQL => sql`(select value from json_each(${JSON.stringify(values)}))`;

export const fromJson = (columns: readonly Column[], rows: readonly (readonly unknown[])[]): SQL => {
  const encoded = rows.map((row) =>
    columns.map((column, at) => {
      const value = row[at];
      return value === null || value === undefined ? null : column.mapToDriverValue(value);
    }),
  );
  return sql`(${sql.join(
    columns.map((column) => sql.identifier(column.name)),
    sql`, `,
  )}) select ${sql.join(
    columns.map((_, at) => sql.raw(`value ->> '$[${at}]'`)),
    sql`, `,
  )} from json_each(${JSON.stringify(encoded)}) where true`;
};

const standingColumns = Effect.fnUntraced(function* <Brand extends StoreBrand>(
  unit: WriteUnit<Brand>,
  db: StoreDb<Brand>,
  table: SQLiteTable,
) {
  const name = getTableName(table);
  const standing = new Set(
    (yield* unit.run(db.all<{ name: string }>(sql`select name from pragma_table_info(${name})`))).map((column) => column.name),
  );
  return Object.entries(getTableColumns(table)).filter(([, column]) => standing.has(column.name));
});

const valueOf = (column: Column, value: unknown) => (value === null ? sql`null` : sql`${column.mapToDriverValue(value)}`);

export const insertRows = Effect.fnUntraced(function* <Brand extends StoreBrand>(
  unit: WriteUnit<Brand>,
  db: StoreDb<Brand>,
  table: SQLiteTable,
  rows: readonly Row[],
) {
  if (rows.length === 0) return;
  const columns = yield* standingColumns(unit, db, table);
  for (const row of rows) {
    const given = columns.filter(([field]) => row[field] !== undefined);
    yield* unit.run(
      db.run(
        sql`insert into ${sql.identifier(getTableName(table))} (${sql.join(
          given.map(([, column]) => sql.identifier(column.name)),
          sql`, `,
        )}) values (${sql.join(
          given.map(([field, column]) => valueOf(column, row[field])),
          sql`, `,
        )})`,
      ),
    );
  }
});

export const updateRows = Effect.fnUntraced(function* <Brand extends StoreBrand>(
  unit: WriteUnit<Brand>,
  db: StoreDb<Brand>,
  table: SQLiteTable,
  key: string,
  rows: readonly Row[],
) {
  if (rows.length === 0) return;
  const columns = yield* standingColumns(unit, db, table);
  const keyed = columns.find(([field]) => field === key);
  if (keyed === undefined) return yield* Effect.die(`${getTableName(table)} has no column ${key}`);
  for (const row of rows) {
    const given = columns.filter(([field]) => field !== key && row[field] !== undefined);
    if (given.length === 0) continue;
    yield* unit.run(
      db.run(
        sql`update ${sql.identifier(getTableName(table))} set ${sql.join(
          given.map(([field, column]) => sql`${sql.identifier(column.name)} = ${valueOf(column, row[field])}`),
          sql`, `,
        )} where ${sql.identifier(keyed[1].name)} = ${valueOf(keyed[1], row[key])}`,
      ),
    );
  }
});
