import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { inDatabase } from '../testing/connection.js';
import { storeSnapshots } from './snapshot.js';

const name = '20261011000000_rewrite';

layer(BunFileSystem.layer)('migration load', (it) => {
  it.effect('a declared heavy update estimates rowid bounds and snapshot participants without reading history bodies', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'migration-load-' });
      yield* fileSystem.makeDirectory(join(root, name));
      yield* fileSystem.writeFileString(join(root, name, 'heavy.json'), JSON.stringify({ reason: 'Rebuild event representation' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots(
        { files: { tables: ['events'], estimate: () => Effect.succeed({ bytes: 4096, hashPasses: 2 }) } },
        yield* sharedPool,
      );
      const pending = [{ name, hash: 'hash', sql: ['update events set body = upper(body)', 'update keyed set body = upper(body)'] }];
      const measured = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table __drizzle_migrations (name text)`);
          yield* db.run(sql`create table events (id integer primary key, body text)`);
          yield* db.run(sql`create table keyed (id text primary key, body text) without rowid`);
          yield* db.run(sql`insert into events values (1000, 'retained')`);
          yield* db.run(sql`insert into keyed values ('one', 'retained')`);
          const estimate = yield* snapshots.estimate({ path, db }, pending, root);
          const rows = yield* db.all<{ body: string }>(sql`select body from events`);
          return { estimate, rows };
        }),
      );
      expect(measured.estimate?.migrations).toEqual([{ name, reason: 'Rebuild event representation' }]);
      expect(measured.estimate?.tables).toEqual(
        expect.arrayContaining([
          { name: 'events', maxRowid: 1000, snapshot: true },
          { name: 'keyed', maxRowid: null, snapshot: true },
        ]),
      );
      expect(measured.estimate?.files).toEqual([{ owner: 'files', bytes: 4096, hashPasses: 2 }]);
      expect(measured.rows).toEqual([{ body: 'retained' }]);
    }),
  );
});
