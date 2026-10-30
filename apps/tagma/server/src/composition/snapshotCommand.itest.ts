import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, FileSystem } from 'effect';
import { capturedEffect } from './testing/captured.js';
import { lockDataDirectory } from '../platform/lock/dataDirectory.js';
import { inDatabase } from '../platform/testing/connection.js';
import { snapshotAssembly } from './snapshots.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('offline snapshots', (it) => {
  it.effect('offline recovery selects a store inside the installation and shares its exclusive lock', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-command-' }));
      const machine = join(root, 'machine.sqlite');
      const graph = join(root, 'graphs', 'one.sqlite');
      const env = { TAGMA_DATABASE_PATH: machine };
      yield* FileSystem.FileSystem.use((files) => files.makeDirectory(join(root, 'graphs')));
      const snapshots = yield* snapshotAssembly(machine, root, yield* sharedPool);
      yield* inDatabase(graph, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact(value text)`);
          yield* db.run(sql`insert into fact values ('before')`);
          yield* snapshots.take({ path: graph, db }, [{ name: 'next', hash: 'next', sql: ["update fact set value = 'after'"] }]);
          yield* db.run(sql`update fact set value='after'`);
        }),
      );
      const lock = yield* lockDataDirectory(root);
      try {
        expect((yield* capturedEffect(['db', 'restore-snapshot', '--store', 'graphs/one.sqlite'], env, root)).code).toBe(1);
      } finally {
        yield* lock.release;
      }
      const live = new Database(graph, { readonly: true });
      try {
        expect(live.query('select value from fact').get()).toEqual({ value: 'after' });
      } finally {
        live.close();
      }
      expect((yield* capturedEffect(['db', 'restore-snapshot', '--store', '../outside.sqlite'], env, root)).code).toBe(1);
      const answer = yield* capturedEffect(['db', 'restore-snapshot', '--store', 'graphs/one.sqlite'], env, root);
      expect(answer.code).toBe(0);
      expect(JSON.parse(answer.out).snapshot).toBeString();
      const restored = new Database(graph, { readonly: true });
      try {
        expect(restored.query('select value from fact').get()).toEqual({ value: 'before' });
      } finally {
        restored.close();
      }
    }),
  );

  it.effect('migration bypass requires confirmation before it opens a store', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-confirm-' }));
      const answer = yield* capturedEffect(
        ['db', 'migrate', '--without-snapshot'],
        { TAGMA_DATABASE_PATH: join(root, 'machine.sqlite') },
        root,
      );
      expect(answer.code).toBe(2);
      expect(yield* FileSystem.FileSystem.use((files) => files.readDirectory(root))).toEqual([]);
      const absent = yield* capturedEffect(
        ['db', 'migrate', '--without-snapshot', '--confirm'],
        { TAGMA_DATABASE_PATH: join(root, 'machine.sqlite') },
        root,
      );
      expect(absent.code).toBe(1);
      expect(yield* FileSystem.FileSystem.use((files) => files.readDirectory(root))).not.toContain('machine.sqlite');
    }),
  );
});
