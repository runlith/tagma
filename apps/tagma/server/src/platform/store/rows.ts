import { Effect } from 'effect';
import { type Column, getTableColumns, getTableName, type SQL, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { StoreBrand, StoreDb, StoreFailure } from '../contract/service/store.js';
import type { WriteUnit } from '../contract/service/units.js';

type Row = Readonly<Record<string, unknown>>;

//! One bound parameter carries the whole list, so no list length meets SQLite's parameter ceiling.
export const among = (values: readonly string[]): SQL => sql`(select value from json_each(${JSON.stringify(values)}))`;

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
