import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Cause, Effect, Exit } from 'effect';
import { MigrationStatementUnresolved } from '../contract/service/store.js';
import { inDatabase, storePlace } from '../testing/connection.js';
import { applyMigration, type Migration } from './chain.js';

const migration = (statements: readonly string[]): Migration => ({
  sql: [...statements],
  bps: true,
  folderMillis: 0,
  hash: 'probe',
  name: 'probe',
});

const applied = Effect.fnUntraced(function* (setup: readonly string[], statements: readonly string[]) {
  const path = yield* storePlace('migration-keys-');
  const exit = yield* inDatabase(path, (db) =>
    Effect.gen(function* () {
      yield* db.run(sql`PRAGMA foreign_keys = OFF`);
      yield* db.run(
        sql`create table __drizzle_migrations (id integer primary key, hash text, created_at integer, name text, applied_at text)`,
      );
      for (const statement of setup) yield* db.run(sql.raw(statement));
      return yield* Effect.exit(applyMigration(db, migration(statements)));
    }),
  );
  return { exit, path };
});

const readBack = <A>(path: string, query: ReturnType<typeof sql>) => inDatabase(path, (db) => db.all<A>(query));

const dangling = (exit: Exit.Exit<unknown, unknown>) => Exit.isFailure(exit) && String(exit.cause).includes('dangling');

const PARENT = [
  'create table parent (id text primary key)',
  "insert into parent values ('a')",
  'create table child (id text primary key, parent_id text references parent (id))',
  "insert into child values ('1', 'a')",
];

const LEGACY_PARENT = ['PRAGMA legacy_alter_table = ON', ...PARENT];

const TRIGGERED = [
  'create table parent (id text primary key, note text)',
  "insert into parent values ('a', 'before')",
  'create table child (id text primary key, parent_id text references parent(id), note text)',
  "insert into child values ('1', 'a', 'before')",
  "insert into child values ('2', 'old-ghost', 'before')",
  'create index child_parent on child(parent_id)',
  'create table unrelated (id text primary key, parent_id text references parent(id))',
  "insert into unrelated values ('ghost', 'missing')",
  'create trigger copied after update of note on parent begin update child set note = new.note; end',
];

const CONFLICT = [
  'create table source (id text primary key)',
  'create table parent (id text primary key, slot text unique)',
  "insert into parent values ('old', 'slot')",
  'create table child (pid text references parent(id))',
  "insert into child values ('old')",
  "create trigger changed after insert on source begin insert into parent(id,slot) values(new.id, 'slot'); end",
];

const landed = Effect.fnUntraced(function* (setup: readonly string[], statements: readonly string[]) {
  const { exit, path } = yield* applied(setup, statements);
  expect(Exit.isSuccess(exit)).toBe(true);
  return yield* readBack<{ note: string }>(path, sql`select note from child where id = '1'`);
});

layer(BunFileSystem.layer)('migration foreign-key check', (it) => {
  it.effect('a reference column added with a default no parent holds is refused, though no row moved', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        ['create table parent (id text primary key)', 'create table child (id text primary key)', "insert into child values ('1')"],
        ["ALTER TABLE `child` ADD COLUMN `parent_id` text REFERENCES `parent`(`id`) DEFAULT 'nobody';"],
      );
      expect(dangling(exit)).toBe(true);
    }),
  );

  it.effect('a parent renamed away under the legacy alter leaves its children pointing at nothing, and is refused', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(LEGACY_PARENT, ['ALTER TABLE `parent` RENAME TO `parent_old`;']);
      expect(dangling(exit)).toBe(true);
    }),
  );

  it.effect('a parent key column renamed even under the legacy alter carries its children along, and lands', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(LEGACY_PARENT, ['ALTER TABLE `parent` RENAME COLUMN `id` TO `pid`;']);
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect('a table renamed as it stands lands over a reference that dangled before the migration, which it did not break', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied([...PARENT, "insert into child values ('2', 'gone')"], ['ALTER TABLE `child` RENAME TO `kid`;']);
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect('a parent rebuilt by copy, drop and rename that keeps every key lands without walking its children', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(PARENT, [
        'CREATE TABLE `__new_parent` (`id` text PRIMARY KEY, `note` text);',
        'INSERT INTO `__new_parent` (`id`) SELECT `id` FROM `parent`;',
        'DROP TABLE `parent`;',
        'ALTER TABLE `__new_parent` RENAME TO `parent`;',
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect('a parent rebuilt by copy, drop and rename that loses a referenced key is refused', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(PARENT, [
        'CREATE TABLE `__new_parent` (`id` text PRIMARY KEY);',
        "INSERT INTO `__new_parent` (`id`) SELECT `id` FROM `parent` WHERE `id` <> 'a';",
        'DROP TABLE `parent`;',
        'ALTER TABLE `__new_parent` RENAME TO `parent`;',
      ]);
      expect(dangling(exit)).toBe(true);
    }),
  );

  it.effect('a parent payload update follows a matching trigger by its written columns and leaves old dangling keys alone', () =>
    Effect.gen(function* () {
      expect(yield* landed(TRIGGERED, ["update parent set note = 'after' where id = 'a'"])).toEqual([{ note: 'after' }]);
    }),
  );

  it.effect('a trigger on other columns does not widen the check', () =>
    Effect.gen(function* () {
      expect(
        yield* landed(
          [
            ...TRIGGERED,
            'drop trigger copied',
            "create trigger copied after update of id on parent begin update unrelated set parent_id = 'bad'; end",
          ],
          ["update parent set note = 'after' where id = 'a'"],
        ),
      ).toEqual([{ note: 'before' }]);
    }),
  );

  it.effect('a trigger that writes a child foreign key fails the migration and rolls its write and ledger back', () =>
    Effect.gen(function* () {
      const { exit, path } = yield* applied(
        [
          ...TRIGGERED,
          'drop trigger copied',
          "create trigger copied after update of note on parent begin update child set parent_id = 'new-ghost' where id = '1'; end",
        ],
        ["update parent set note = 'after' where id = 'a'"],
      );
      expect(dangling(exit)).toBe(true);
      const state = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          const parent = yield* db.all(sql`select note from parent`);
          const child = yield* db.all(sql`select parent_id from child where id = '1'`);
          const ledger = yield* db.all(sql`select name from __drizzle_migrations`);
          return { parent, child, ledger };
        }),
      );
      expect(state).toEqual({ parent: [{ note: 'before' }], child: [{ parent_id: 'a' }], ledger: [] });
    }),
  );

  it.effect('deleting a parent probes the removed keys and ignores earlier ghosts in the same child', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        [...TRIGGERED, "insert into parent values ('unreferenced', '')"],
        ["delete from parent where id = 'unreferenced'"],
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect('deleting or updating a referenced parent key refuses the migration', () =>
    Effect.gen(function* () {
      for (const statement of ["delete from parent where id = 'a'", "update parent set id = 'changed' where id = 'a'"]) {
        const { exit } = yield* applied(TRIGGERED, [statement]);
        expect(dangling(exit)).toBe(true);
      }
    }),
  );

  it.effect('a new trigger is followed and a dropped trigger is not followed within the migration', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(TRIGGERED, [
        "create trigger broken after update of note on parent begin update unrelated set parent_id = 'new-ghost'; end",
        'drop trigger broken',
        "update parent set note = 'after' where id = 'a'",
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect('an active trigger created by the migration cannot hide its dangling writes', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(TRIGGERED, [
        "create trigger broken after update of note on parent begin update unrelated set parent_id = 'new-ghost'; end",
        "update parent set note = 'after' where id = 'a'",
      ]);
      expect(dangling(exit)).toBe(true);
    }),
  );

  it.effect('an unresolved statement returns a typed refusal instead of executing it', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(PARENT, ['create table copy as select * from parent']);
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(MigrationStatementUnresolved);
    }),
  );

  it.effect('checking a child key keeps SQLite parent affinity, collation, and composite NULL semantics', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        [
          'create table parent (id text collate nocase, n integer, primary key(id,n))',
          "insert into parent values ('01', 1)",
          'create table child (id text, n text, note text, foreign key(id,n) references parent(id,n))',
          "insert into child values ('01', '1', '')",
          "insert into child values (null, 'missing', '')",
        ],
        ['update child set id = id'],
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect('a child numeric affinity cannot erase the parent text distinction during a foreign-key check', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        [
          'create table parent (id text primary key)',
          "insert into parent values ('01')",
          'create table child (id integer references parent(id))',
        ],
        ['insert into child values (1)'],
      );
      expect(dangling(exit)).toBe(true);
    }),
  );

  it.effect('updating a rowid alias checks the integer primary key it changes', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        [
          'create table parent (id integer primary key)',
          'insert into parent values (1)',
          'create table child (pid integer references parent(id))',
          'insert into child values (1)',
        ],
        ['update parent set rowid = 2'],
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('updating the source of a generated child foreign key checks the derived key', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        [
          'create table parent (id text primary key)',
          "insert into parent values ('a')",
          'create table child (raw text, pid text generated always as(raw) virtual references parent(id))',
          "insert into child(raw) values ('a')",
        ],
        ["update child set raw = 'missing'"],
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('a trigger inherits the outer REPLACE policy and cannot orphan a parent reference', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(CONFLICT, ["insert or replace into source values ('new')"]);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('a schema-declared REPLACE on a unique constraint cannot orphan a parent reference', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        [
          'create table parent (id text primary key, slot text unique on conflict replace)',
          "insert into parent values ('old', 'slot')",
          'create table child (pid text references parent(id))',
          "insert into child values ('old')",
        ],
        ["insert into parent values ('new', 'slot')"],
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('a dropped unique parent index refuses a child write even when its value still exists', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        [
          'create table parent (id text)',
          'create unique index parent_key on parent(id)',
          "insert into parent values ('a')",
          'create table child (pid text references parent(id))',
        ],
        ['drop index parent_key', "insert into child values ('a')"],
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('a declared column named rowid does not change the parent primary key', () =>
    Effect.gen(function* () {
      const { exit, path } = yield* applied(
        [
          'create table parent (id integer primary key, rowid text)',
          "insert into parent values (1, 'before')",
          'create table child (pid integer references parent(id))',
          'insert into child values (99)',
        ],
        ["update parent set rowid = 'after'"],
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* readBack(path, sql`select rowid from parent`)).toEqual([{ rowid: 'after' }]);
    }),
  );

  it.effect('an unrelated update does not recheck a generated key or fire an UPDATE OF that derived column', () =>
    Effect.gen(function* () {
      const { exit, path } = yield* applied(
        [
          'create table parent (id text primary key)',
          'create table child (raw text, note text, pid text as(raw) stored references parent(id))',
          "insert into child(raw,note) values ('old-ghost','before')",
          'create table unrelated (pid text references parent(id))',
          "insert into unrelated values ('another-ghost')",
          "create trigger derived after update of pid on child begin update unrelated set pid = 'new-ghost'; end",
        ],
        ["update child set note = 'after'"],
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* readBack(path, sql`select note from child`)).toEqual([{ note: 'after' }]);
    }),
  );

  it.effect('an outer IGNORE policy overrides REPLACE written in the trigger body', () =>
    Effect.gen(function* () {
      const { exit, path } = yield* applied(
        [
          ...CONFLICT,
          'drop trigger changed',
          "create trigger changed after insert on source begin insert or replace into parent(id,slot) values(new.id,'slot'); end",
        ],
        ["insert or ignore into source values ('new')"],
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* readBack(path, sql`select id from parent`)).toEqual([{ id: 'old' }]);
    }),
  );

  it.effect('a written child remains checked after it is renamed by the same migration', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(PARENT, ["update child set parent_id = 'ghost'", 'alter table child rename to kid']);
      expect(dangling(exit)).toBe(true);
    }),
  );

  it.effect('a new nullable foreign key does not revisit older keys in the same table', () =>
    Effect.gen(function* () {
      const { exit, path } = yield* applied(
        [...PARENT, "insert into child values ('old', 'ghost')"],
        ['alter table child add column added text references parent(id)'],
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* readBack(path, sql`select added from child where id = 'old'`)).toEqual([{ added: null }]);
    }),
  );

  it.effect('a constant default foreign key probes its parent without revisiting older keys', () =>
    Effect.gen(function* () {
      const { exit, path } = yield* applied(
        [...PARENT, "insert into child values ('old', 'ghost')"],
        ["alter table child add column added text references parent(id) default 'a'"],
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* readBack(path, sql`select added from child where id = 'old'`)).toEqual([{ added: 'a' }]);
    }),
  );

  it.effect('a foreign key added with a valid default is checked normally after a later write changes it', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(PARENT, [
        "alter table child add column added text references parent(id) default 'a'",
        "update child set added = 'ghost'",
      ]);
      expect(dangling(exit)).toBe(true);
    }),
  );

  it.effect('an unresolved trigger body names its own operator and rolls back preceding migration writes', () =>
    Effect.gen(function* () {
      const body = "insert into π values ('a')";
      const { exit, path } = yield* applied(
        [
          'create table parent (id text primary key, note text)',
          "insert into parent values ('a', 'before')",
          'create table π (id text)',
          `create trigger unread after update of note on parent begin ${body}; end`,
        ],
        ["insert into parent values ('b', 'before')", "update parent set note = 'after' where id = 'a'"],
      );
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      expect(failure).toBeInstanceOf(MigrationStatementUnresolved);
      expect(failure).toMatchObject({ migration: 'probe', statement: body });
      expect(yield* readBack(path, sql`select id, note from parent`)).toEqual([{ id: 'a', note: 'before' }]);
    }),
  );

  it.effect('an upsert cannot orphan a parent key that its UPDATE clause changes', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(PARENT, ["insert into parent values ('a') on conflict(id) do update set id = 'changed'"]);
      expect(dangling(exit)).toBe(true);
    }),
  );

  it.effect('a new default key is checked after SQLite applies the child column affinity', () =>
    Effect.gen(function* () {
      const { exit } = yield* applied(
        [
          'create table parent(id text primary key)',
          "insert into parent values ('01')",
          'create table child(id text)',
          "insert into child values ('one')",
        ],
        ["alter table child add column added integer references parent(id) default '01'"],
      );
      expect(dangling(exit)).toBe(true);
    }),
  );
});
