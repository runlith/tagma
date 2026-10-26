import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { inDatabase, storePlace } from '../testing/connection.js';
import { storeSnapshots } from './snapshot.js';

const SCHEMA = [
  'create table __drizzle_migrations (id integer primary key, hash text, created_at integer, name text, applied_at text)',
  'create table doc (id integer primary key, text text not null)',
  "create virtual table doc_fts using fts5(text, content = 'doc', content_rowid = 'id', tokenize = 'trigram')",
  'create trigger doc_ai after insert on doc begin insert into doc_fts(rowid, text) values (new.id, new.text); end',
  "create trigger doc_ad after delete on doc begin insert into doc_fts(doc_fts, rowid, text) values ('delete', old.id, old.text); end",
  "insert into doc (id, text) values (1, 'alpha'), (2, 'beta'), (3, 'gamma')",
];

const PRUNE = ['DELETE FROM `doc` WHERE `id` = 2;'];

const INDEX = [
  'CREATE TABLE `note` (`key` integer PRIMARY KEY, `text` text NOT NULL);',
  "CREATE VIRTUAL TABLE `note_fts` USING fts5(`text`, content = '', contentless_delete = 1, tokenize = 'trigram');",
  'CREATE TRIGGER `note_ad` AFTER DELETE ON `note` BEGIN DELETE FROM `note_fts` WHERE `rowid` = old.`key`; END;',
];

layer(BunFileSystem.layer, { excludeTestServices: true })('snapshot search mirrors', (it) => {
  it.effect(
    'an external-content search mirror a migration writes through its trigger is rebuilt from its restored content, never copied',
    () =>
      Effect.gen(function* () {
        const path = yield* storePlace('snapshot-mirror-');
        const snapshots = storeSnapshots({});
        yield* inDatabase(path, (db) =>
          Effect.gen(function* () {
            for (const statement of SCHEMA) yield* db.run(sql.raw(statement));
            yield* snapshots.take({ path, db }, [{ name: 'prune', hash: 'prune', sql: PRUNE }]);
            for (const statement of PRUNE) yield* db.run(sql.raw(statement));
          }),
        );
        const manifest = JSON.parse(readFileSync(`${path}.snapshot.json`, 'utf8')) as {
          tables: Array<{ name: string }>;
          rebuilt: string[];
        };
        expect(manifest.rebuilt).toEqual(['doc_fts']);
        expect(manifest.tables.map((table) => table.name)).not.toContain('doc_fts');

        yield* snapshots.restore(path);

        const after = yield* inDatabase(path, (db) =>
          Effect.gen(function* () {
            yield* db.run(sql`insert into doc_fts(doc_fts, rank) values ('integrity-check', 1)`);
            const found = yield* db.all<{ id: number }>(sql`select rowid as id from doc_fts where doc_fts match 'eta' order by rowid`);
            yield* db.run(sql`delete from doc where id = 2`);
            const pruned = yield* db.all<{ id: number }>(sql`select rowid as id from doc_fts where doc_fts match 'eta' order by rowid`);
            return { found, pruned };
          }),
        );
        expect(after.found).toEqual([{ id: 2 }]);
        expect(after.pruned).toEqual([]);
      }),
  );

  it.effect('a search index a migration creates is a schema-only target its restore drops together with its shadow tables', () =>
    Effect.gen(function* () {
      const path = yield* storePlace('snapshot-index-');
      const snapshots = storeSnapshots({});
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          for (const statement of SCHEMA) yield* db.run(sql.raw(statement));
          yield* snapshots.take({ path, db }, [{ name: 'index', hash: 'index', sql: INDEX }]);
          for (const statement of INDEX) yield* db.run(sql.raw(statement));
          yield* db.run(sql`insert into note (key, text) values (1, 'delta')`);
          yield* db.run(sql`insert into note_fts (rowid, text) values (1, 'delta')`);
        }),
      );
      const manifest = JSON.parse(readFileSync(`${path}.snapshot.json`, 'utf8')) as {
        tables: Array<{ name: string; definition: string | null }>;
      };
      expect(manifest.tables.find((table) => table.name === 'note_fts')).toMatchObject({ definition: null });

      yield* snapshots.restore(path, { acceptLoss: [] });

      const standing = yield* inDatabase(path, (db) =>
        db.all<{ name: string }>(sql`select name from sqlite_master where name like 'note%' order by name`),
      );
      expect(standing).toEqual([]);
    }),
  );
});
