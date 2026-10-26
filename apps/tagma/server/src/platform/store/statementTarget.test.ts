import { describe, expect, test } from 'bun:test';
import { schemaStatement, statementTarget, triggerShape } from './statementTarget.js';

const write = (table: string, columns: readonly string[] | 'all') => ({
  kind: 'write',
  table,
  columns: columns === 'all' ? 'all' : new Set(columns),
});

describe('the target of a statement', () => {
  test('an insert names its table and the columns it lists, upsert assignments included', () => {
    expect(statementTarget('insert into "thread_run" ("id", "status") values (?, ?)')).toMatchObject(write('thread_run', ['id', 'status']));
    expect(
      statementTarget(
        'insert into "setting" ("key", "scope") values (?, ?) on conflict ("key") do update set "value" = excluded."value", "revision" = ?',
      ),
    ).toMatchObject(write('setting', ['key', 'scope', 'value', 'revision']));
    expect(statementTarget("INSERT OR REPLACE INTO meta(key, value) VALUES ('a', 'b')")).toMatchObject({
      ...write('meta', 'all'),
      replacing: true,
    });
    expect(statementTarget('replace into cache values (1, 2)')).toMatchObject(write('cache', 'all'));
  });

  test('an update names its table and the columns it sets, whatever the expressions hold', () => {
    expect(
      statementTarget('update "thread_run" set "heartbeat_at" = ?, "progress" = coalesce("progress", ?) where "thread_run"."id" = ?'),
    ).toMatchObject(write('thread_run', ['heartbeat_at', 'progress']));
    expect(statementTarget('UPDATE t SET (a, b) = (1, 2), c = (select max(x) from y where z = 1) WHERE id = 3')).toMatchObject(
      write('t', ['a', 'b', 'c']),
    );
  });

  test('a delete writes whole rows, and a common table expression before it is read past', () => {
    expect(statementTarget('delete from "session" where "id" = ?')).toMatchObject(write('session', 'all'));
    expect(
      statementTarget(
        'with doomed as (select id from block where kind = \'delete from x, y\') delete from "block" where id in (select id from doomed)',
      ),
    ).toMatchObject(write('block', 'all'));
  });

  test('reads, pragmas and temporary tables are not writes a unit declares', () => {
    for (const sql of [
      'select * from "block" where id = ?',
      "-- insert into a\nselect 'delete from b'",
      'PRAGMA foreign_key_check',
      'create temp table x (id integer)',
      'drop table if exists temp.x',
    ])
      expect(statementTarget(sql)).toEqual({ kind: 'other' });
    expect(statementTarget('insert into temp.scratch (a) values (1)')).toEqual({ kind: 'other', temporary: true });
  });

  test('a quoted column named like a keyword does not end the assignments, and another schema keeps its name', () => {
    expect(statementTarget('update t set allowed = "from", forbidden = 1')).toMatchObject(write('t', ['allowed', 'forbidden']));
    expect(statementTarget('update main.block set a = 1')).toMatchObject(write('block', ['a']));
    expect(statementTarget('delete from machine.block')).toMatchObject(write('machine.block', 'all'));
  });

  test('a write whose target cannot be read, a schema change and a second statement are unresolved rather than guessed', () => {
    for (const sql of [
      'insert (a) values (1)',
      'update set a = 1',
      'with x as select 1 delete from y',
      'drop table other',
      'create table x (id integer)',
      'insert into a (x) values (1); delete from b',
    ])
      expect(statementTarget(sql)).toEqual({ kind: 'unresolved' });
    expect(statementTarget('; delete from other')).toMatchObject(write('other', 'all'));
  });
});

describe('the schema of a statement', () => {
  test('table creation names its table, virtual or not, and marks temporary tables', () => {
    expect(schemaStatement('CREATE TABLE `thread` (`id` text);')).toEqual({ kind: 'create-table', table: 'thread', temporary: false });
    expect(schemaStatement('CREATE VIRTUAL TABLE `search_fts` USING fts5(`text`, content = `search_index`);')).toEqual({
      kind: 'create-table',
      table: 'search_fts',
      temporary: false,
    });
    expect(schemaStatement('create table if not exists "Block" (id integer)')).toEqual({
      kind: 'create-table',
      table: 'block',
      temporary: false,
    });
    expect(schemaStatement("-- a note\nCREATE TABLE t (a TEXT DEFAULT ';');")).toEqual({
      kind: 'create-table',
      table: 't',
      temporary: false,
    });
    expect(schemaStatement('CREATE TEMP TABLE `d4_stub` (`thread_id` text);')).toEqual({
      kind: 'create-table',
      table: 'd4_stub',
      temporary: true,
    });
    expect(schemaStatement('CREATE TABLE temp.d4_cut (a integer);')).toEqual({ kind: 'create-table', table: 'd4_cut', temporary: true });
    expect(schemaStatement('CREATE TABLE main.t (a integer);')).toEqual({ kind: 'create-table', table: 't', temporary: false });
    expect(schemaStatement('CREATE TABLE other.t (a integer);')).toEqual({ kind: 'unresolved' });
    expect(schemaStatement('CREATE TEMP TABLE `w` AS SELECT `id` FROM `t`;')).toEqual({
      kind: 'create-table',
      table: 'w',
      temporary: true,
    });
    expect(schemaStatement('CREATE TABLE `w` AS SELECT `id` FROM `t`;')).toEqual({ kind: 'unresolved' });
  });

  test('table removal and alteration name their table, renames both names, additions the column', () => {
    expect(schemaStatement('DROP TABLE IF EXISTS `thread`;')).toEqual({ kind: 'drop-table', table: 'thread', temporary: false });
    expect(schemaStatement('DROP TABLE temp.scratch;')).toEqual({ kind: 'drop-table', table: 'scratch', temporary: true });
    expect(schemaStatement('ALTER TABLE `conversation` RENAME TO `thread`;')).toEqual({
      kind: 'alter-table',
      table: 'conversation',
      temporary: false,
      renameTo: 'thread',
      addedColumn: null,
    });
    expect(schemaStatement("ALTER TABLE `search_index` ADD `title_text` text DEFAULT '' NOT NULL;")).toEqual({
      kind: 'alter-table',
      table: 'search_index',
      temporary: false,
      renameTo: null,
      addedColumn: 'title_text',
    });
    expect(schemaStatement('ALTER TABLE t ADD COLUMN c TEXT;')).toEqual({
      kind: 'alter-table',
      table: 't',
      temporary: false,
      renameTo: null,
      addedColumn: 'c',
    });
    expect(schemaStatement('ALTER TABLE `thread` RENAME COLUMN `parent_conversation_id` TO `parent_thread_id`;')).toEqual({
      kind: 'alter-table',
      table: 'thread',
      temporary: false,
      renameTo: null,
      addedColumn: null,
    });
    expect(schemaStatement('ALTER TABLE `workflow_run` DROP COLUMN `lease_until`;')).toEqual({
      kind: 'alter-table',
      table: 'workflow_run',
      temporary: false,
      renameTo: null,
      addedColumn: null,
    });
    expect(schemaStatement('ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (a);')).toEqual({ kind: 'unresolved' });
    expect(schemaStatement('ALTER TABLE t ADD COLUMN;')).toEqual({ kind: 'unresolved' });
    expect(schemaStatement('ALTER TABLE other.t ADD c TEXT;')).toEqual({ kind: 'unresolved' });
  });

  test('index creation names its index and owner, removal its index', () => {
    expect(schemaStatement('CREATE UNIQUE INDEX IF NOT EXISTS `thread_owner_idx` ON `thread` (`owner_id`);')).toEqual({
      kind: 'create-index',
      index: 'thread_owner_idx',
      table: 'thread',
      temporary: false,
    });
    expect(
      schemaStatement(
        'CREATE UNIQUE INDEX `thread_run_active_unique` ON `thread_run` (`thread_id`) WHERE "thread_run"."status" = \'running\';',
      ),
    ).toEqual({
      kind: 'create-index',
      index: 'thread_run_active_unique',
      table: 'thread_run',
      temporary: false,
    });
    expect(schemaStatement('CREATE INDEX IDX ON Tbl (C);')).toEqual({ kind: 'create-index', index: 'idx', table: 'tbl', temporary: false });
    expect(schemaStatement('CREATE INDEX i ON temp.t (a);')).toEqual({ kind: 'create-index', index: 'i', table: 't', temporary: true });
    expect(schemaStatement('DROP INDEX IF EXISTS `block_parent_idx`;')).toEqual({
      kind: 'drop-index',
      index: 'block_parent_idx',
      temporary: false,
    });
    expect(schemaStatement('CREATE INDEX i ON other.t (a);')).toEqual({ kind: 'unresolved' });
  });

  test('trigger creation names its trigger, owner and body, removal its trigger', () => {
    const tally = schemaStatement(
      'CREATE TRIGGER `terminal_operation_tally_au` AFTER UPDATE OF `outcome` ON `terminal_operation` WHEN old.`outcome` IS NOT new.`outcome` BEGIN\n' +
        'UPDATE `terminal_operation_tally` SET `count` = `count` - 1 WHERE `outcome` = old.`outcome`;\n' +
        'INSERT INTO `terminal_operation_tally` (`outcome`, `count`) VALUES (new.`outcome`, 1);\nEND;',
    );
    expect(tally).toMatchObject({
      kind: 'create-trigger',
      trigger: 'terminal_operation_tally_au',
      table: 'terminal_operation',
      temporary: false,
    });
    if (tally.kind !== 'create-trigger') throw new Error('expected a trigger');
    expect(tally.body).toHaveLength(2);
    expect(tally.body.join('\n')).toContain('count` = `count` - 1');
    const quoted = schemaStatement("CREATE TRIGGER t AFTER INSERT ON m BEGIN INSERT INTO m (a) VALUES ('x;y'); UPDATE m SET a = 1; END;");
    expect(quoted).toMatchObject({ kind: 'create-trigger', trigger: 't', table: 'm' });
    if (quoted.kind !== 'create-trigger') throw new Error('expected a trigger');
    expect(quoted.body).toHaveLength(2);
    expect(quoted.body.join('\n')).toContain('x;y');
    expect(schemaStatement('DROP TRIGGER IF EXISTS `search_index_ai`;')).toEqual({
      kind: 'drop-trigger',
      trigger: 'search_index_ai',
      temporary: false,
    });
    expect(schemaStatement('CREATE TRIGGER t AFTER INSERT ON m BEGIN INSERT INTO m VALUES (1); END; DROP TABLE m;')).toEqual({
      kind: 'unresolved',
    });
  });

  test('a stored trigger reads as its event, its columns and body statements split only where the body splits', () => {
    const shape = triggerShape(
      'CREATE TRIGGER t AFTER UPDATE OF a, "b" ON m BEGIN -- not; here\n' +
        "UPDATE n SET c = CASE WHEN new.a = 'x;y' THEN 1 ELSE 0 END WHERE id = new.id; /* nor; here */ DELETE FROM o WHERE k = old.id; END",
    );
    expect(shape.on).toBe('update');
    expect([...(shape.of ?? [])]).toEqual(['a', 'b']);
    expect(shape.body).toHaveLength(2);
    expect(statementTarget(shape.body[0]!)).toMatchObject(write('n', ['c']));
    expect(statementTarget(shape.body[1]!)).toMatchObject(write('o', 'all'));
  });

  test('view creation and removal name their view', () => {
    expect(schemaStatement('CREATE VIEW v AS SELECT 1;')).toEqual({ kind: 'create-view', view: 'v', temporary: false });
    expect(schemaStatement('CREATE TEMP VIEW v AS SELECT 1;')).toEqual({ kind: 'create-view', view: 'v', temporary: true });
    expect(schemaStatement('/* x;y */ DROP VIEW IF EXISTS v;')).toEqual({ kind: 'drop-view', view: 'v', temporary: false });
    expect(schemaStatement('CREATE VIEW other.v AS SELECT 1;')).toEqual({ kind: 'unresolved' });
  });

  test('writes and stacked statements stay unresolved for the write-set parser', () => {
    for (const sql of [
      'insert into a (x) values (1)',
      'update t set a = 1',
      'delete from t',
      'insert into d4_stub (thread_id) values (?)',
      'with x as (select 1) delete from y',
      'CREATE TABLE a (x); DROP TABLE b;',
      'SELECT 1; SELECT 2;',
      "ATTACH DATABASE 'f' AS s;",
    ])
      expect(schemaStatement(sql)).toEqual({ kind: 'unresolved' });
  });

  test('connection pragmas and metadata reads stay plannable while mutations do not', () => {
    for (const sql of [
      'PRAGMA foreign_keys=OFF;',
      'PRAGMA foreign_keys = ON;',
      'PRAGMA foreign_keys;',
      'PRAGMA legacy_alter_table;',
      'PRAGMA foreign_key_check;',
      'PRAGMA foreign_key_check("thread");',
      'PRAGMA main.foreign_key_check;',
      "select name from sqlite_master where type = 'table';",
      '',
      '-- nothing here',
    ])
      expect(schemaStatement(sql)).toEqual({ kind: 'other' });
    for (const sql of [
      'PRAGMA user_version = 3;',
      'PRAGMA schema_version;',
      'PRAGMA writable_schema = ON;',
      'PRAGMA journal_mode = WAL;',
      'PRAGMA foreign_keys = 2;',
      'PRAGMA secure_delete = ON;',
    ])
      expect(schemaStatement(sql)).toEqual({ kind: 'unresolved' });
  });

  test('the legacy alter switch reads as the setting it leaves, because a rename rewrites other objects only with it off', () => {
    expect(schemaStatement('PRAGMA legacy_alter_table = OFF;')).toEqual({ kind: 'legacy-alter', on: false });
    expect(schemaStatement('PRAGMA legacy_alter_table=1')).toEqual({ kind: 'legacy-alter', on: true });
    expect(schemaStatement('PRAGMA legacy_alter_table = maybe;')).toEqual({ kind: 'unresolved' });
  });
});
