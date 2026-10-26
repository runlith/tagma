import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { storeLayer } from '../../platform/store/open.js';

const MIGRATION = '20261026200000_main_placements';

layer(BunFileSystem.layer, { excludeTestServices: true })('placements on a former main checkout', (it) => {
  it.effect("opening moves a project's threads from its former main checkout to its main checkout and leaves every other place", () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-main-placements-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      const repair = join(folder, MIGRATION);
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(repair);
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE thread (id text PRIMARY KEY, project_id integer);',
          'CREATE TABLE repository (repository_id text PRIMARY KEY, common_directory text, project_id integer);',
          'CREATE TABLE file_root (root_id text PRIMARY KEY, repository_id text, git_directory text);',
          'CREATE TABLE project_root (project_id integer, root_id text, origin text, PRIMARY KEY (project_id, root_id));',
          'CREATE TABLE assignment_selection (thread_id text PRIMARY KEY, root_id text, provenance text, revision integer);',
          'CREATE TABLE assignment_membership (thread_id text, root_id text, provenance text, PRIMARY KEY (thread_id, root_id));',
          "INSERT INTO repository VALUES ('old-repo', '/old/.git', 5), ('new-repo', '/new/.git', 5), ('other-repo', '/other/.git', 7);",
          "INSERT INTO file_root VALUES ('old-main', 'old-repo', '/old/.git'), ('old-linked', 'old-repo', '/old/.git/worktrees/side'), ('new-main', 'new-repo', '/new/.git'), ('other-main', 'other-repo', '/other/.git');",
          "INSERT INTO project_root VALUES (5, 'new-main', 'canonical'), (7, 'other-main', 'canonical');",
          "INSERT INTO thread VALUES ('moved', 5), ('linked', 5), ('stranger', 7);",
          "INSERT INTO assignment_selection VALUES ('moved', 'old-main', 'explicit', 3), ('linked', 'old-linked', 'explicit', 1), ('stranger', 'old-main', 'explicit', 2);",
          "INSERT INTO assignment_membership VALUES ('moved', 'old-main', 'explicit'), ('linked', 'old-linked', 'explicit'), ('stranger', 'old-main', 'explicit');",
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(
        new URL(`../../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname,
        join(repair, 'migration.sql'),
      );
      const context = yield* Layer.build(
        storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }),
      );
      const { db } = Context.get(context, MachineStore);
      expect(yield* db.all(sql`select thread_id, root_id, revision from assignment_selection order by thread_id`)).toEqual([
        { thread_id: 'linked', root_id: 'old-linked', revision: 1 },
        { thread_id: 'moved', root_id: 'new-main', revision: 4 },
        { thread_id: 'stranger', root_id: 'old-main', revision: 2 },
      ]);
      expect(yield* db.all(sql`select thread_id, root_id from assignment_membership order by thread_id, root_id`)).toEqual([
        { thread_id: 'linked', root_id: 'old-linked' },
        { thread_id: 'moved', root_id: 'new-main' },
        { thread_id: 'stranger', root_id: 'old-main' },
      ]);
    }),
  );
});
