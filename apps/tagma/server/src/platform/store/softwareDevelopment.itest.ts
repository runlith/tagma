import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';

const MIGRATION = '20261017030000_software_development';

layer(BunFileSystem.layer, { excludeTestServices: true })('stored software-development name', (it) => {
  it.effect('opening renames the catalog choice in every scope, in place and without duplicates, and preserves unrelated settings', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-software-development-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      const move = join(folder, MIGRATION);
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(move);
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE setting (id integer PRIMARY KEY, scope text, project_id integer, key text, value text);',
          'INSERT INTO setting VALUES (1, \'user\', null, \'graph.catalogs\', \'["core","code-project","notes"]\');',
          "INSERT INTO setting VALUES (2, 'project', 7, 'graph.catalogs', '[\"code-project\",\"software-development\"]');",
          "INSERT INTO setting VALUES (3, 'project', 8, 'graph.catalogs', '[\"notes\"]');",
          "INSERT INTO setting VALUES (4, 'project', 9, 'other', '[\"code-project\"]');",
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(new URL(`../../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname, join(move, 'migration.sql'));
      const context = yield* Layer.build(
        storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
      );
      const { db } = Context.get(context, MachineStore);
      expect(yield* db.all(sql`select id, value from setting order by id`)).toEqual([
        { id: 1, value: '["core","software-development","notes"]' },
        { id: 2, value: '["software-development"]' },
        { id: 3, value: '["notes"]' },
        { id: 4, value: '["code-project"]' },
      ]);
    }),
  );
});
