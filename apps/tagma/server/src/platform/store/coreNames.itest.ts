import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('stored core names', (it) => {
  it.effect('opening translates catalog choices in every scope and preserves unrelated settings', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-core-names-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      const move = join(folder, '20261016210000_core_names');
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(move);
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE setting (id integer PRIMARY KEY, scope text, project_id integer, key text, value text);',
          "INSERT INTO setting VALUES (1, 'user', null, 'graph.catalogs', '[\"lode\",\"code-project\"]');",
          'INSERT INTO setting VALUES (2, \'project\', 7, \'graph.catalogs\', \'["core","lode","notes"]\');',
          "INSERT INTO setting VALUES (3, 'project', 8, 'graph.catalogs', '[\"lode\"]');",
          "INSERT INTO setting VALUES (4, 'project', 9, 'other', '[\"lode\"]');",
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(
        new URL('../../../drizzle/20261016210000_core_names/migration.sql', import.meta.url).pathname,
        join(move, 'migration.sql'),
      );
      const context = yield* Layer.build(
        storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
      );
      const { db } = Context.get(context, MachineStore);
      expect(yield* db.all(sql`select id, value from setting order by id`)).toEqual([
        { id: 1, value: '["core","code-project"]' },
        { id: 2, value: '["core","notes"]' },
        { id: 3, value: '["core"]' },
        { id: 4, value: '["lode"]' },
      ]);
    }),
  );
});
