import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';
import { inDatabase } from '../platform/testing/connection.js';
import { storeSnapshots } from '../platform/store/snapshot.js';

const manifestOf = Effect.fnUntraced(function* (path: string) {
  return JSON.parse(yield* FileSystem.FileSystem.use((files) => files.readFileString(`${path}.snapshot.json`))) as {
    id: string;
    tables: Array<{ name: string }>;
  };
});

const fileTablesOf = (copied: string) => {
  const db = new Database(copied, { readonly: true });
  try {
    return (db.query("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
  } finally {
    db.close();
  }
};

layer(BunFileSystem.layer, { excludeTestServices: true })('scoped snapshots', (it) => {
  it.effect('an update restores one table while leaving unrelated newer rows untouched', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-scoped-' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots({});
      const pending = [{ name: 'migrate-one', hash: 'one', sql: ["update fact set value = 'after'"] }];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact (id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* db.run(sql`create table other (id text primary key, value text)`);
          yield* db.run(sql`insert into other values ('seed', 'seed')`);
          yield* snapshots.take({ path, db }, pending);
          yield* db.run(sql`update fact set value = 'after'`);
          yield* db.run(sql`insert into other values ('new', 'new')`);
        }),
      );
      expect(yield* snapshots.standing(path)).toBe(true);
      const answer = yield* snapshots.restore(path);
      expect(answer.losses.some((loss) => loss.table === 'fact')).toBe(true);
      const live = new Database(path, { readonly: true });
      try {
        expect(live.query('select id, value from fact order by id').all()).toEqual([{ id: 'kept', value: 'before' }]);
        expect(live.query('select id, value from other order by id').all()).toEqual([
          { id: 'new', value: 'new' },
          { id: 'seed', value: 'seed' },
        ]);
      } finally {
        live.close();
      }
    }),
  );

  it.effect('a create-only cut holds no unrelated data and additive undo preserves live rows', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-schema-only-' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots({});
      const pending = [
        {
          name: 'migrate-schema',
          hash: 'schema',
          sql: ['create table fresh (id text primary key, value text)', 'alter table fact add column extra text'],
        },
      ];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact (id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* db.run(sql`create table other (id text primary key, value text)`);
          yield* db.run(sql`insert into other values ('kept', 'keep')`);
          yield* snapshots.take({ path, db }, pending);
        }),
      );
      const manifest = yield* manifestOf(path);
      expect(manifest.tables.map((table) => table.name).includes('other')).toBe(false);
      const copied = join(`${path}.snapshots`, manifest.id, 'store.sqlite');
      expect(fileTablesOf(copied).includes('other')).toBe(false);
      expect(fileTablesOf(copied).includes('fresh')).toBe(false);
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fresh (id text primary key, value text)`);
          yield* db.run(sql`insert into fresh values ('f', 'fresh')`);
          yield* db.run(sql`alter table fact add column extra text`);
          yield* db.run(sql`update fact set value = 'after', extra = 'extra'`);
          yield* db.run(sql`insert into other values ('new', 'new')`);
        }),
      );
      yield* snapshots.restore(path);
      const after = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          const tables = yield* db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name = 'fresh'`);
          const columns = yield* db.all<{ name: string }>(sql`select name from pragma_table_info('fact')`);
          const facts = yield* db.all<{ id: string; value: string }>(sql`select id, value from fact`);
          const others = yield* db.all<{ id: string; value: string }>(sql`select id, value from other order by id`);
          return { tables, columns, facts, others };
        }),
      );
      expect(after.tables).toEqual([]);
      expect(after.columns.map((column) => column.name).includes('extra')).toBe(false);
      expect(after.facts).toEqual([{ id: 'kept', value: 'after' }]);
      expect(after.others).toEqual([
        { id: 'kept', value: 'keep' },
        { id: 'new', value: 'new' },
      ]);
    }),
  );

  it.effect('rowids and autoincrement sequences beyond 2^53 restore exactly, including without rowid', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-rowid-' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots({});
      const pending = [
        {
          name: 'migrate-rowid',
          hash: 'rowid',
          sql: [
            "update r set value = 'migrated' where id = 'big'",
            "update a set value = 'migrated' where id = 1",
            "update w set value = 'migrated' where id = 'k'",
          ],
        },
      ];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table r (id text, value text)`);
          yield* db.run(sql`insert into r (rowid, id, value) values (9007199254740993, 'big', 'before')`);
          yield* db.run(sql`insert into r (id, value) values ('small', 'before')`);
          yield* db.run(sql`create table a (id integer primary key autoincrement, value text)`);
          yield* db.run(sql`insert into a (value) values ('before')`);
          yield* db.run(sql`update sqlite_sequence set seq = 9007199254740993 where name = 'a'`);
          yield* db.run(sql`create table w (id text primary key, value text) without rowid`);
          yield* db.run(sql`insert into w values ('k', 'before')`);
          yield* snapshots.take({ path, db }, pending);
          yield* db.run(sql`update r set value = 'after'`);
          yield* db.run(sql`insert into a (value) values ('after')`);
          yield* db.run(sql`update w set value = 'after'`);
        }),
      );
      yield* snapshots.restore(path);
      const after = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          const rowids = yield* db.all<{ r: string; id: string; value: string }>(
            sql`select cast(rowid as text) as r, id, value from r order by rowid`,
          );
          const seq = yield* db.all<{ s: string }>(sql`select cast(seq as text) as s from sqlite_sequence where name = 'a'`);
          const ids = yield* db.all<{ id: string }>(sql`select cast(id as text) as id from a order by id`);
          const wrows = yield* db.all<{ id: string; value: string }>(sql`select id, value from w`);
          return { rowids, seq, ids, wrows };
        }),
      );
      expect(after.rowids).toEqual([
        { r: '9007199254740993', id: 'big', value: 'before' },
        { r: '9007199254740994', id: 'small', value: 'before' },
      ]);
      expect(after.seq).toEqual([{ s: '9007199254740993' }]);
      expect(after.ids).toEqual([{ id: '1' }]);
      expect(after.wrows).toEqual([{ id: 'k', value: 'before' }]);
    }),
  );
});
