import { getTableName, sql, type GetColumnData, type SQL, type Table } from 'drizzle-orm';
import { SQLiteDialect, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type {
  RowChange,
  RowProjection as SqlProjection,
  RowSelection as SqlSelection,
  SelectedRow,
  RowValue,
} from '@runlith/sqlite-process/channel';

export type ProjectionRow<Columns extends Readonly<Record<string, SQLiteColumn>>> = {
  readonly [K in keyof Columns]: GetColumnData<Columns[K], 'query'>;
};

type RowFact<Columns extends Readonly<Record<string, SQLiteColumn>>, Key extends keyof Columns> = {
  readonly key: Pick<ProjectionRow<Columns>, Key>;
  readonly address: RowValue;
  readonly before: RowValue;
} & (
  | { readonly kind: 'insert'; readonly values: ProjectionRow<Columns> }
  | { readonly kind: 'update' | 'delete'; readonly values: Partial<ProjectionRow<Columns>> }
);

export type RowProjection<
  Columns extends Readonly<Record<string, SQLiteColumn>> = Readonly<Record<string, SQLiteColumn>>,
  Key extends keyof Columns = keyof Columns,
> = {
  readonly table: Table;
  readonly columns: Columns;
  readonly raw: SqlProjection;
  readonly fact: (change: RowChange) => RowFact<Columns, Key> | undefined;
};

export const projectRows = <const Columns extends Readonly<Record<string, SQLiteColumn>>, const Key extends keyof Columns & string>(input: {
  readonly id: string;
  readonly table: Table;
  readonly columns: Columns;
  readonly keys: readonly Key[];
  readonly address?: keyof Columns & string;
  readonly context?: readonly (keyof Columns & string)[];
}): RowProjection<Columns, Key> => {
  const byName = new Map(Object.entries(input.columns).map(([key, column]) => [column.name, { key, column }]));
  const decode = (column: SQLiteColumn, value: RowValue) => (value === null ? null : column.mapFromDriverValue(value));
  return {
    table: input.table,
    columns: input.columns,
    raw: {
      id: input.id,
      table: getTableName(input.table),
      keys: input.keys.map((key) => input.columns[key]!.name),
      columns: [...byName.keys()],
      ...(input.address === undefined ? {} : { address: input.columns[input.address]!.name }),
      ...(input.context === undefined ? {} : { context: input.context.map((key) => input.columns[key]!.name) }),
    },
    fact: (change) => {
      if (change.projection !== input.id) return undefined;
      const key = Object.fromEntries(input.keys.map((key, index) => [key, decode(input.columns[key]!, change.key[index]!)])) as Pick<
        ProjectionRow<Columns>,
        Key
      >;
      const values: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(change.values)) {
        const field = byName.get(name)!;
        values[field.key] = decode(field.column, value);
      }
      const identity = { key, address: change.address, before: change.before };
      return change.kind === 'insert'
        ? { ...identity, kind: 'insert', values: values as ProjectionRow<Columns> }
        : { ...identity, kind: change.kind, values: values as Partial<ProjectionRow<Columns>> };
    },
  };
};

type RowCodec<A> = { readonly decode: (value: RowValue) => A };
type SelectionColumn = SQLiteColumn | RowCodec<unknown>;
export type SelectionRow<Columns extends Readonly<Record<string, SelectionColumn>>> = {
  readonly [K in keyof Columns]: Columns[K] extends RowCodec<infer A>
    ? A
    : Columns[K] extends SQLiteColumn
      ? GetColumnData<Columns[K], 'query'>
      : never;
};

export const nullableColumn = <Column extends SQLiteColumn>(column: Column): RowCodec<GetColumnData<Column, 'query'> | null> => ({
  decode: (value) => (value === null ? null : column.mapFromDriverValue(value)),
});

type RowSelection<Columns extends Readonly<Record<string, SelectionColumn>>> = {
  readonly raw: SqlSelection;
  readonly columns: Columns;
  readonly query: (key: SQL) => SQL;
  readonly encoded: (key: SQL) => SQL<SelectionRow<Columns> | null>;
  readonly value: (selected: SelectedRow) => SelectionRow<Columns> | null | undefined;
};

export const selectRows = <const Columns extends Readonly<Record<string, SelectionColumn>>>(input: {
  readonly id: string;
  readonly query: (key: SQL) => SQL;
  readonly columns: Columns;
  readonly sources: readonly { readonly rows: RowProjection; readonly columns: readonly string[]; readonly when?: (row: SQL) => SQL }[];
}): RowSelection<Columns> => {
  const decode = (values: Readonly<Record<string, RowValue>>): SelectionRow<Columns> =>
    Object.fromEntries(
      Object.entries(input.columns).map(([key, column]) => {
        const raw = values[key]!;
        return [key, 'decode' in column ? column.decode(raw) : raw === null ? null : column.mapFromDriverValue(raw)];
      }),
    ) as SelectionRow<Columns>;
  return {
    raw: {
      id: input.id,
      sql: new SQLiteDialect().sqlToQuery(input.query(sql.raw('?1')).inlineParams()).sql,
      columns: Object.keys(input.columns),
      sources: input.sources.map((source) => ({
        projection: source.rows.raw.id,
        columns: source.columns,
        ...(source.when === undefined ? {} : { when: new SQLiteDialect().sqlToQuery(source.when(sql.raw('$row')).inlineParams()).sql }),
      })),
    },
    columns: input.columns,
    query: input.query,
    encoded: (key) =>
      sql<string | null>`(select json_object(${sql.join(
        Object.keys(input.columns).flatMap((name) => [sql`${name}`, sql`selected.${sql.identifier(name)}`]),
        sql`, `,
      )}) from (${input.query(key)}) selected)`.mapWith((raw: string | null) => (raw === null ? null : decode(JSON.parse(raw)))),
    value: (selected) => (selected.selection !== input.id ? undefined : selected.values === null ? null : decode(selected.values)),
  };
};
