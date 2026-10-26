import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';

const MIGRATION = '20261020160000_knowledge_names';

layer(BunFileSystem.layer, { excludeTestServices: true })('stored knowledge name', (it) => {
  it.effect('opening moves catalog choices in every scope without duplicates and preserves unrelated settings', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-knowledge-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      const move = join(folder, MIGRATION);
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(move);
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE setting (id integer PRIMARY KEY, scope text, project_id integer, key text, value text);',
          'INSERT INTO setting VALUES (1, \'user\', null, \'graph.catalogs\', \'["core","notes","software-development"]\');',
          'INSERT INTO setting VALUES (2, \'project\', 7, \'graph.catalogs\', \'["knowledge","notes","knowledge"]\');',
          "INSERT INTO setting VALUES (3, 'project', 8, 'graph.catalogs', '[\"notes\"]');",
          "INSERT INTO setting VALUES (4, 'project', 9, 'other', '[\"notes\"]');",
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(new URL(`../../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname, join(move, 'migration.sql'));
      const context = yield* Layer.build(
        storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }),
      );
      const { db } = Context.get(context, MachineStore);
      expect(yield* db.all(sql`select id, value from setting order by id`)).toEqual([
        { id: 1, value: '["core","knowledge","software-development"]' },
        { id: 2, value: '["knowledge"]' },
        { id: 3, value: '["knowledge"]' },
        { id: 4, value: '["notes"]' },
      ]);
    }),
  );
});
