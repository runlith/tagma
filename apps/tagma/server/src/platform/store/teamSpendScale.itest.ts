import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';

const MIGRATION = '20261029185000_team_spend_scale';

const models = JSON.stringify([
  { provider: 'a', model: 'm', reasoning: 'high', spend: 1 },
  { provider: 'a', model: 'm', reasoning: 'xhigh', spend: 4, depth: 3 },
  { provider: 'a', on: false },
  { provider: 'b', model: 'n', reasoning: null, spend: 5 },
]);

layer(BunFileSystem.layer, { excludeTestServices: true })('stored sub-agent spend', (it) => {
  it.effect('opening moves every stored spend from 1–5 to 1–10 in settings and thread copies, leaving the rest untouched', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-spend-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      const move = join(folder, MIGRATION);
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(move);
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE setting (id integer PRIMARY KEY, scope text, project_id integer, key text, value text);',
          'CREATE TABLE thread_mandate (id text PRIMARY KEY, team text);',
          `INSERT INTO setting VALUES (1, 'user', null, 'agent.models', '${models}');`,
          `INSERT INTO setting VALUES (2, 'project', 7, 'agent.models', '[{"provider":"a","model":"m","reasoning":"high","spend":3}]');`,
          `INSERT INTO setting VALUES (3, 'project', 7, 'other', '[{"spend":3}]');`,
          `INSERT INTO thread_mandate VALUES ('t1', '{"models":[{"provider":"a","model":"m","reasoning":"high","spend":2}],"review":{"reviewers":1}}');`,
          `INSERT INTO thread_mandate VALUES ('t2', null);`,
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(new URL(`../../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname, join(move, 'migration.sql'));
      const context = yield* Layer.build(
        storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
      );
      const { db } = Context.get(context, MachineStore);
      const settings = yield* db.all<{ id: number; value: string }>(sql`select id, value from setting order by id`);
      expect(settings.map((row) => [row.id, JSON.parse(row.value)])).toEqual([
        [
          1,
          [
            { provider: 'a', model: 'm', reasoning: 'high', spend: 1 },
            { provider: 'a', model: 'm', reasoning: 'xhigh', spend: 8, depth: 3 },
            { provider: 'a', on: false },
            { provider: 'b', model: 'n', reasoning: null, spend: 10 },
          ],
        ],
        [2, [{ provider: 'a', model: 'm', reasoning: 'high', spend: 5 }]],
        [3, [{ spend: 3 }]],
      ]);
      expect(yield* db.all(sql`select id, team from thread_mandate order by id`)).toEqual([
        { id: 't1', team: '{"models":[{"provider":"a","model":"m","reasoning":"high","spend":3}],"review":{"reviewers":1}}' },
        { id: 't2', team: null },
      ]);
    }),
  );
});
