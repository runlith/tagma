import { Database } from 'bun:sqlite';
import { selectEngine } from '@runlith/sqlite-process/engine';

export type SchemaObject = { readonly type: string; readonly name: string; readonly table: string; readonly definition: string | null };

export type SchemaTable = { readonly name: string; readonly kind: 'table' | 'virtual' | 'shadow'; readonly columns: readonly string[] };

export type SchemaPragmas = { readonly legacyAlterTable: boolean; readonly foreignKeys: boolean };

export type SchemaRewrites = { readonly rewritten: readonly SchemaObject[] } | { readonly unread: string };

const ORDER: Readonly<Record<string, number>> = { table: 0, index: 1, view: 2, trigger: 3 };

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const keyOf = (type: string, name: string): string => `${type}:${name.toLowerCase()}`;

const definitions = (scratch: Database): ReadonlyMap<string, string | null> =>
  new Map(
    scratch
      .query<{ type: string; name: string; sql: string | null }, []>('select type, name, sql from sqlite_master')
      .all()
      .map((row) => [keyOf(row.type, row.name), row.sql]),
  );

export const schemaRewrites = (
  catalog: readonly SchemaObject[],
  tables: readonly SchemaTable[],
  pragmas: SchemaPragmas,
  statements: readonly string[],
): SchemaRewrites => {
  const kinds = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
  const replayed = catalog
    .filter(
      (row) =>
        row.definition !== null &&
        !row.name.startsWith('sqlite_') &&
        kinds.get(row.table.toLowerCase())?.kind !== 'shadow' &&
        row.type in ORDER,
    )
    .toSorted((a, b) => ORDER[a.type]! - ORDER[b.type]!);
  selectEngine();
  const scratch = new Database(':memory:');
  try {
    scratch.exec('PRAGMA foreign_keys = OFF');
    for (const row of replayed) {
      const table = row.type === 'table' ? kinds.get(row.name.toLowerCase()) : undefined;
      scratch.exec(
        table?.kind === 'virtual'
          ? `CREATE TABLE ${quoted(row.name)} (${(table.columns.length === 0 ? ['_'] : table.columns).map(quoted).join(', ')})`
          : row.definition!,
      );
    }
    scratch.exec(`PRAGMA legacy_alter_table = ${pragmas.legacyAlterTable ? 'ON' : 'OFF'}`);
    scratch.exec(`PRAGMA foreign_keys = ${pragmas.foreignKeys ? 'ON' : 'OFF'}`);
    const before = definitions(scratch);
    for (const statement of statements) scratch.exec(statement);
    const after = definitions(scratch);
    return { rewritten: replayed.filter((row) => before.get(keyOf(row.type, row.name)) !== after.get(keyOf(row.type, row.name))) };
  } catch (failure) {
    return { unread: failure instanceof Error ? failure.message : String(failure) };
  } finally {
    scratch.close();
  }
};
