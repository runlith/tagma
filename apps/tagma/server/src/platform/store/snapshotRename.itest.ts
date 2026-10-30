import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { inDatabase, storePlace } from '../testing/connection.js';
import { storeSnapshots } from './snapshot.js';

const SCHEMA = [
  'create table __drizzle_migrations (id integer primary key, hash text, created_at integer, name text, applied_at text)',
  'create table op (id integer primary key autoincrement, outcome text not null)',
  'create table op_tally (outcome text primary key, n integer not null)',
  'create index op_outcome on op (outcome)',
  'create trigger op_ai after insert on op begin insert into op_tally (outcome, n) values (new.outcome, 1) on conflict (outcome) do update set n = n + 1; end',
  "insert into op (outcome) values ('a'), ('a'), ('b')",
];

const RENAME = [
  'ALTER TABLE `op` RENAME TO `request_key`;',
  'ALTER TABLE `op_tally` RENAME TO `request_key_tally`;',
  'DROP TRIGGER `op_ai`;',
  'CREATE TRIGGER `request_key_ai` AFTER INSERT ON `request_key` BEGIN INSERT INTO `request_key_tally` (`outcome`, `n`) VALUES (new.`outcome`, 1) ON CONFLICT (`outcome`) DO UPDATE SET `n` = `n` + 1; END;',
];

const catalog = (path: string) =>
  inDatabase(path, (db) =>
    db.all<{ type: string; name: string; table: string }>(
      sql`select type, name, tbl_name as "table" from sqlite_master where name not like 'sqlite_%' order by type, name`,
    ),
  );

type Manifest = { tables: Array<{ name: string; data: boolean; renamed?: string }>; rows: Record<string, number> };

const manifestAt = (path: string) => JSON.parse(readFileSync(`${path}.snapshot.json`, 'utf8')) as Manifest;

layer(BunFileSystem.layer, { excludeTestServices: true })('snapshot of renamed tables', (it) => {
  it.effect('a table the migrations only rename is captured as schema and renamed back, keeping every row it holds at restore', () =>
    Effect.gen(function* () {
      const path = yield* storePlace('snapshot-rename-');
      const snapshots = storeSnapshots({}, yield* sharedPool);
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          for (const statement of SCHEMA) yield* db.run(sql.raw(statement));
        }),
      );
      const before = yield* catalog(path);
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`PRAGMA legacy_alter_table = ON`);
          yield* snapshots.take({ path, db }, [{ name: 'rename', hash: 'rename', sql: RENAME }]);
          for (const statement of RENAME) yield* db.run(sql.raw(statement));
          yield* db.run(sql`insert into request_key (outcome) values ('c')`);
        }),
      );
      const manifest = manifestAt(path);
      expect(
        manifest.tables.filter((table) => table.renamed !== undefined).map(({ name, data, renamed }) => ({ name, data, renamed })),
      ).toEqual([
        { name: 'op', data: false, renamed: 'request_key' },
        { name: 'op_tally', data: false, renamed: 'request_key_tally' },
      ]);
      expect(manifest.rows.op).toBeUndefined();

      yield* snapshots.restore(path);

      expect(yield* catalog(path)).toEqual(before);
      const after = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          const rows = yield* db.all<{ id: number; outcome: string }>(sql`select id, outcome from op order by id`);
          const tally = yield* db.all<{ outcome: string; n: number }>(sql`select outcome, n from op_tally order by outcome`);
          const sequence = yield* db.all<{ name: string; seq: number }>(sql`select name, seq from sqlite_sequence order by name`);
          yield* db.run(sql`insert into op (outcome) values ('d')`);
          const fired = yield* db.all<{ n: number }>(sql`select n from op_tally where outcome = 'd'`);
          return { rows, tally, sequence, fired };
        }),
      );
      expect(after.rows).toEqual([
        { id: 1, outcome: 'a' },
        { id: 2, outcome: 'a' },
        { id: 3, outcome: 'b' },
        { id: 4, outcome: 'c' },
      ]);
      expect(after.tally).toEqual([
        { outcome: 'a', n: 2 },
        { outcome: 'b', n: 1 },
        { outcome: 'c', n: 1 },
      ]);
      expect(after.sequence).toEqual([{ name: 'op', seq: 4 }]);
      expect(after.fired).toEqual([{ n: 1 }]);
    }),
  );

  it.effect('a rename under the current alter, which rewrites what refers to the table, is captured with its rows', () =>
    Effect.gen(function* () {
      const path = yield* storePlace('snapshot-rename-current-');
      const snapshots = storeSnapshots({}, yield* sharedPool);
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          for (const statement of SCHEMA) yield* db.run(sql.raw(statement));
          yield* snapshots.take({ path, db }, [{ name: 'rename', hash: 'rename', sql: ['PRAGMA legacy_alter_table = OFF;', ...RENAME] }]);
        }),
      );
      const manifest = manifestAt(path);
      expect(manifest.tables.filter((table) => table.renamed !== undefined)).toEqual([]);
      expect(manifest.tables.find((table) => table.name === 'op')).toMatchObject({ data: true });
    }),
  );

  it.effect('a renamed table the migrations also write is captured with its rows, as before', () =>
    Effect.gen(function* () {
      const path = yield* storePlace('snapshot-rename-written-');
      const snapshots = storeSnapshots({}, yield* sharedPool);
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          for (const statement of SCHEMA) yield* db.run(sql.raw(statement));
          yield* snapshots.take({ path, db }, [
            { name: 'rename', hash: 'rename', sql: [...RENAME, "UPDATE `request_key` SET `outcome` = 'z';"] },
          ]);
        }),
      );
      const manifest = manifestAt(path);
      expect(manifest.tables.find((table) => table.name === 'op')).toMatchObject({ data: true });
      expect(manifest.tables.find((table) => table.name === 'op')?.renamed).toBeUndefined();
    }),
  );
});
