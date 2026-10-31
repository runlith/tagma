import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';

const MIGRATION = '20261031123400_team_review_rows';

const SOL_XHIGH = { provider: 'o', model: 'sol', reasoning: 'xhigh' };
const SOL_HIGH = { provider: 'o', model: 'sol', reasoning: 'high' };
const row = (id: number, scope: string, project: number | null, key: string, value: unknown) =>
  `INSERT INTO setting VALUES (${id}, '${scope}', ${project ?? 'null'}, '${key}', '${JSON.stringify(value)}', 0, null, 1);`;

layer(BunFileSystem.layer, { excludeTestServices: true })('stored reviewer pools', (it) => {
  it.effect(
    'opening turns each pool into rows marked for review in its layer, unmarks in a project the machine rows its own pool left out, and drops pool and split',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-review-' });
        const folder = join(root, 'drizzle');
        const base = join(folder, '20260101000000_base');
        const move = join(folder, MIGRATION);
        yield* files.makeDirectory(base, { recursive: true });
        yield* files.makeDirectory(move);
        yield* files.writeFileString(
          join(base, 'migration.sql'),
          [
            'CREATE TABLE setting (id integer PRIMARY KEY, scope text, project_id integer, key text, value text, declined integer, session_id integer, updated_at integer);',
            'CREATE TABLE thread_mandate (id text PRIMARY KEY, team text);',
            row(1, 'user', null, 'agent.models', [{ provider: 'o', on: false }]),
            row(2, 'user', null, 'agent.review', { reviewers: 1, pool: [SOL_XHIGH, SOL_HIGH], split: 'same', lenses: ['tests'] }),
            row(3, 'project', 7, 'agent.review', { reviewers: 2, pool: [SOL_HIGH], split: 'lenses', lenses: ['tests'] }),
            row(4, 'project', 8, 'agent.review', { reviewers: 1, pool: [], split: 'same', lenses: [] }),
            row(5, 'project', 8, 'agent.models', [{ ...SOL_HIGH, depth: 4 }]),
            `INSERT INTO thread_mandate VALUES ('t1', '${JSON.stringify({ models: [{ ...SOL_HIGH, depth: 3 }], review: { reviewers: 1, pool: [SOL_XHIGH], split: 'same', lenses: [] } })}');`,
            `INSERT INTO thread_mandate VALUES ('t2', null);`,
          ].join('\n--> statement-breakpoint\n'),
        );
        yield* files.copyFile(
          new URL(`../../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname,
          join(move, 'migration.sql'),
        );
        const context = yield* Layer.build(
          storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
        );
        const { db } = Context.get(context, MachineStore);
        const settings = yield* db.all<{ scope: string; project_id: number | null; key: string; value: string }>(
          sql`select scope, project_id, key, value from setting order by scope, project_id, key`,
        );
        expect(settings.map((one) => [one.scope, one.project_id, one.key, JSON.parse(one.value)])).toEqual([
          [
            'project',
            7,
            'agent.models',
            [
              { ...SOL_XHIGH, reviews: false },
              { ...SOL_HIGH, reviews: true },
            ],
          ],
          ['project', 7, 'agent.review', { reviewers: 2, lenses: ['tests'] }],
          [
            'project',
            8,
            'agent.models',
            [
              { ...SOL_HIGH, depth: 4 },
              { ...SOL_XHIGH, reviews: false },
              { ...SOL_HIGH, reviews: false },
            ],
          ],
          ['project', 8, 'agent.review', { reviewers: 1, lenses: [] }],
          [
            'user',
            null,
            'agent.models',
            [
              { provider: 'o', on: false },
              { ...SOL_XHIGH, reviews: true },
              { ...SOL_HIGH, reviews: true },
            ],
          ],
          ['user', null, 'agent.review', { reviewers: 1, lenses: [] }],
        ]);
        const threads = yield* db.all<{ id: string; team: string | null }>(sql`select id, team from thread_mandate order by id`);
        expect(threads.map((one) => [one.id, one.team === null ? null : JSON.parse(one.team)])).toEqual([
          [
            't1',
            {
              models: [
                { ...SOL_HIGH, depth: 3 },
                { ...SOL_XHIGH, reviews: true },
              ],
              review: { reviewers: 1, lenses: [] },
            },
          ],
          ['t2', null],
        ]);
      }),
  );
});
