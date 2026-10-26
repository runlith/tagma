import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { type SchemaObject, type SchemaPragmas, schemaRewrites, type SchemaTable } from './schemaRewrites.js';

const catalogOf = (schema: string): { readonly catalog: readonly SchemaObject[]; readonly tables: readonly SchemaTable[] } => {
  const db = new Database(':memory:');
  try {
    db.exec(schema);
    const catalog = db.query<SchemaObject, []>('select type, name, tbl_name as "table", sql as definition from sqlite_master').all();
    const tables = db
      .query<{ name: string; type: string }, []>(
        "select name, type from pragma_table_list where schema = 'main' and type in ('virtual', 'shadow')",
      )
      .all()
      .map((table): SchemaTable => ({
        name: table.name,
        kind: table.type === 'virtual' ? 'virtual' : 'shadow',
        columns:
          table.type === 'virtual'
            ? db
                .query<{ name: string }, [string]>('select name from pragma_table_xinfo(?)')
                .all(table.name)
                .map((column) => column.name)
            : [],
      }));
    return { catalog, tables };
  } finally {
    db.close();
  }
};

const LEGACY: SchemaPragmas = { legacyAlterTable: true, foreignKeys: false };

const rewritten = (schema: string, statements: readonly string[], pragmas = LEGACY): readonly string[] | string => {
  const { catalog, tables } = catalogOf(schema);
  const answer = schemaRewrites(catalog, tables, pragmas, statements);
  return 'unread' in answer ? answer.unread : answer.rewritten.map((row) => `${row.type}:${row.name}`).sort();
};

const SCHEMA = `
  CREATE TABLE terminal (id text PRIMARY KEY, generation integer NOT NULL DEFAULT 0);
  CREATE TABLE terminal_writer (id text PRIMARY KEY, terminal_id text NOT NULL REFERENCES terminal(id) ON DELETE CASCADE);
  CREATE INDEX terminal_writer_terminal ON terminal_writer (terminal_id);
  CREATE VIEW open_terminal AS SELECT id FROM terminal;
  CREATE VIRTUAL TABLE search USING fts5(body);
  CREATE TRIGGER terminal_search AFTER INSERT ON terminal BEGIN INSERT INTO search (body) VALUES (new.id); END;
`;

test('dropping a column rewrites only its own table, whatever references that table', () => {
  expect(rewritten(SCHEMA, ['ALTER TABLE `terminal` DROP COLUMN `generation`;'])).toEqual(['table:terminal']);
});

test('renaming a table under the legacy alter the migrations run with rewrites the table and its own triggers only', () => {
  expect(rewritten(SCHEMA, ['ALTER TABLE `terminal` RENAME TO `terminal_old`;'])).toEqual(['table:terminal', 'trigger:terminal_search']);
});

test('renaming a table under the current alter rewrites every object that names it, in other tables, views and triggers', () => {
  expect(rewritten(SCHEMA, ['ALTER TABLE `terminal` RENAME TO `terminal_old`;'], { legacyAlterTable: false, foreignKeys: false })).toEqual([
    'table:terminal',
    'table:terminal_writer',
    'trigger:terminal_search',
    'view:open_terminal',
  ]);
});

test('a virtual table and its shadow tables replay, and writes rewrite no schema', () => {
  expect(rewritten(SCHEMA, ["INSERT INTO terminal (id) VALUES ('t1');", "UPDATE terminal_writer SET terminal_id = 't1';"])).toEqual([]);
});

test('a write through the hidden column of a virtual table replays on the copy', () => {
  expect(rewritten(SCHEMA, ["INSERT INTO search (search) VALUES ('rebuild');"])).toEqual([]);
});

test('a statement the copy cannot run leaves the rewrites unread', () => {
  expect(typeof rewritten(SCHEMA, ['ALTER TABLE `absent` RENAME TO `other`;'])).toBe('string');
});
