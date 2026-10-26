import { Database } from 'bun:sqlite';
import { PATH_ENDINGS, type Relocated } from '../../platform/contract/service/relocation.js';

export type RowsMoved = { readonly table: string; readonly column: string; readonly rows: number };

type Column = { readonly name: string; readonly type: string };

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const literal = (text: string): string => `'${text.replaceAll("'", "''")}'`;

const ENDINGS = PATH_ENDINGS;

const relocatedSql = (column: string, places: readonly Relocated[]): string =>
  places.reduce((value, { from, to }) => {
    const replaced = ENDINGS.reduce(
      (inner, ending) => `replace(${inner}, ${literal(`${from}${ending}`)}, ${literal(`${to}${ending}`)})`,
      value,
    );
    return `CASE WHEN ${value} = ${literal(from)} THEN ${literal(to)} WHEN substr(${replaced}, -${from.length}) = ${literal(from)} THEN substr(${replaced}, 1, length(${replaced}) - ${from.length}) || ${literal(to)} ELSE ${replaced} END`;
  }, column);

export const moveRows = (database: string, tables: readonly string[], places: readonly Relocated[]): readonly RowsMoved[] => {
  const db = new Database(database);
  try {
    db.run('PRAGMA busy_timeout = 10000');
    const moved: RowsMoved[] = [];
    db.transaction(() => {
      for (const table of tables) {
        for (const column of db.query<Column, []>(`PRAGMA table_info(${quoted(table)})`).all()) {
          if (!/TEXT|CHAR|CLOB|JSON|^$/i.test(column.type)) continue;
          const named = quoted(column.name);
          const found = places.map(({ from }) => `instr(${named}, ${literal(from)}) > 0`).join(' OR ');
          const changed = db.run(
            `UPDATE ${quoted(table)} SET ${named} = ${relocatedSql(named, places)} WHERE typeof(${named}) = 'text' AND (${found})`,
          ).changes;
          if (changed > 0) moved.push({ table, column: column.name, rows: changed });
        }
      }
    }).immediate();
    return moved;
  } finally {
    db.close();
  }
};
