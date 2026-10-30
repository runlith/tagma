import { expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { inDatabase, storePlace } from '../../platform/testing/connection.js';
import { applyMigration } from '../../platform/store/chain.js';
import { storeSnapshots } from '../../platform/store/snapshot.js';

const name = '20261012234446_change_text';
const folder = new URL('../../../drizzle/', import.meta.url).pathname;

const setup = [
  'pragma foreign_keys = ON',
  'create table __drizzle_migrations (id integer primary key, hash text, created_at integer, name text, applied_at text)',
  'create table project (id integer primary key)',
  'insert into project values (1)',
  'create table workspace_change (id text primary key, project_id integer not null references project(id) on delete cascade, state text not null, before_hash text, after_hash text, old_text text, new_text text)',
  'create index workspace_change_project_idx on workspace_change(project_id)',
  "create index workspace_change_retired_texts_idx on workspace_change(id) where state in ('committed', 'withdrawn') and (old_text is not null or new_text is not null)",
  'create table released_line (row text primary key references workspace_change(id) on delete cascade, span text)',
  "insert into workspace_change values ('held', 1, 'held', 'a', 'b', 'до\n', 'после\n'), ('landed', 1, 'committed', 'b', 'c', '', 'carried\n'), ('gone', 1, 'withdrawn', 'c', null, 'removed\n', null), ('bare', 1, 'committed', null, 'd', null, null)",
  "insert into released_line values ('gone', 'digest witness')",
];

const logical = sql`select r.id, r.project_id, r.state, r.before_hash, r.after_hash, t.old_text, t.new_text
  from workspace_change r left join workspace_change_text t on t.row = r.id order by r.id`;

const queue = sql`select row from workspace_change_retired_text order by row`;
const catalog = sql`select type, name, tbl_name from sqlite_master where name not like 'sqlite_%' order by type, name`;

it.live(
  'moving hunk storage preserves logical rows and witnesses, queues ended payload, and snapshot restore recovers the original rows',
  () =>
    Effect.gen(function* () {
      const path = yield* storePlace('change-text-');
      const snapshots = storeSnapshots({}, yield* sharedPool);
      const migration = {
        name,
        hash: 'change-text',
        folderMillis: 0,
        bps: true,
        sql: (yield* Effect.promise(() => readFile(join(folder, name, 'migration.sql'), 'utf8'))).split('--> statement-breakpoint'),
      };
      const before = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          for (const statement of setup) yield* db.run(sql.raw(statement));
          const rows = yield* db.all(sql`select * from workspace_change order by id`);
          const objects = yield* db.all(catalog);
          const estimate = yield* snapshots.estimate({ path, db }, [migration], folder);
          expect(estimate?.tables).toContainEqual({ name: 'workspace_change', maxRowid: 4, snapshot: true });
          yield* snapshots.take({ path, db }, [migration]);
          yield* applyMigration(db, migration);
          expect(yield* db.all(logical)).toEqual(rows);
          expect(yield* db.all(queue)).toEqual([{ row: 'gone' }, { row: 'landed' }]);
          expect(yield* db.all(sql`select * from released_line`)).toEqual([{ row: 'gone', span: 'digest witness' }]);
          yield* db.run(sql`update workspace_change set state = 'committed' where id = 'held'`);
          expect(yield* db.all(queue)).toEqual([{ row: 'gone' }, { row: 'held' }, { row: 'landed' }]);
          yield* db.run(sql`insert into workspace_change_text values ('bare', null, 'late payload')`);
          expect(yield* db.all(queue)).toEqual([{ row: 'bare' }, { row: 'gone' }, { row: 'held' }, { row: 'landed' }]);
          yield* db.run(sql`delete from workspace_change_text where row = 'gone'`);
          expect(yield* db.all(queue)).toEqual([{ row: 'bare' }, { row: 'held' }, { row: 'landed' }]);
          expect(yield* db.all(sql`select * from released_line`)).toEqual([{ row: 'gone', span: 'digest witness' }]);
          yield* db.run(sql`delete from workspace_change where id = 'landed'`);
          expect(yield* db.all(sql`select row from workspace_change_text order by row`)).toEqual([{ row: 'bare' }, { row: 'held' }]);
          expect(yield* db.all(sql`pragma foreign_key_check`)).toEqual([]);
          return { rows, objects };
        }),
      );
      yield* snapshots.restore(path);
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          expect(yield* db.all(sql`select * from workspace_change order by id`)).toEqual(before.rows);
          expect(yield* db.all(catalog)).toEqual(before.objects);
          expect(yield* db.all(sql`select * from released_line`)).toEqual([{ row: 'gone', span: 'digest witness' }]);
          expect(yield* db.all(sql`pragma foreign_key_check`)).toEqual([]);
          expect(yield* db.all(sql`select name from __drizzle_migrations`)).toEqual([]);
        }),
      );
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
