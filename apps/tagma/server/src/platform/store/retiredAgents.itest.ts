import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';

const RETIRED = [
  ['20261017161000_developer_retired', 'developer'],
  ['20261020153000_rules_retired', 'rules'],
] as const;

const CODE = ['agents', 'files', 'shell', 'web', 'mcp', 'plugins', 'skills', 'threads', 'peers', 'resources', 'sandbox', 'worktrees'];

layer(BunFileSystem.layer, { excludeTestServices: true })('stored threads of a retired agent', (it) => {
  for (const [migration, gone] of RETIRED) {
    it.effect(
      `opening moves ${gone} threads, their hosted bindings, derived profiles and settings onto tagma, keeping each narrowing`,
      () =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const root = yield* files.makeTempDirectoryScoped({ prefix: `tagma-${gone}-retired-` });
          const folder = join(root, 'drizzle');
          const base = join(folder, '20260101000000_base');
          const move = join(folder, migration);
          yield* files.makeDirectory(base, { recursive: true });
          yield* files.makeDirectory(move);
          const former = JSON.stringify({ id: gone, overlay: { id: gone, baseAgentId: gone, description: '', capabilities: CODE } });
          const scout = JSON.stringify({
            id: 'scout',
            overlay: { id: 'scout', baseAgentId: gone, description: 'd', capabilities: ['files'] },
          });
          yield* files.writeFileString(
            join(base, 'migration.sql'),
            [
              'CREATE TABLE thread (id text PRIMARY KEY, agent_id text NOT NULL);',
              'CREATE TABLE native_thread (id text PRIMARY KEY, profile text, transport text NOT NULL);',
              'CREATE TABLE setting (id integer PRIMARY KEY, key text, value text, declined integer NOT NULL DEFAULT 0);',
              `INSERT INTO thread VALUES ('plain', '${gone}'), ('former', '${gone}'), ('hosted', 'harness'), ('lead', 'tagma');`,
              `INSERT INTO native_thread VALUES ('plain', null, '{"adapter":"native"}'), ('former', '${former}', '{"adapter":"native"}'), ('hosted', '${scout}', '{"adapter":"acp","profile":"claude","agent":"${gone}"}'), ('lead', null, '{"adapter":"native"}');`,
              `INSERT INTO setting (id, key, value) VALUES (1, 'agent.default', '"${gone}"'), (2, 'agent.offered', '[{"type":"${gone}","to":"operator"},{"type":"tutor","to":"agents"}]');`,
            ].join('\n--> statement-breakpoint\n'),
          );
          yield* files.copyFile(
            new URL(`../../../drizzle/${migration}/migration.sql`, import.meta.url).pathname,
            join(move, 'migration.sql'),
          );
          const context = yield* Layer.build(
            storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
          );
          const { db } = Context.get(context, MachineStore);
          const rows = yield* db.all<{ id: string; agent: string; profile: string | null; transport: string }>(
            sql`select t.id, t.agent_id as agent, n.profile, n.transport from thread t join native_thread n on n.id = t.id order by t.id`,
          );
          expect(
            rows.map((row) => [
              row.id,
              row.agent,
              (JSON.parse(row.transport) as { agent?: string }).agent,
              row.profile === null ? null : JSON.parse(row.profile),
            ]),
          ).toEqual([
            [
              'former',
              'tagma',
              undefined,
              { id: 'tagma', overlay: { id: 'tagma', baseAgentId: 'tagma', description: '', capabilities: CODE } },
            ],
            [
              'hosted',
              'harness',
              'tagma',
              { id: 'scout', overlay: { id: 'scout', baseAgentId: 'tagma', description: 'd', capabilities: ['files'] } },
            ],
            ['lead', 'tagma', undefined, null],
            ['plain', 'tagma', undefined, null],
          ]);
          expect(yield* db.all(sql`select id, value from setting order by id`)).toEqual([
            { id: 1, value: '"tagma"' },
            { id: 2, value: '[{"type":"tagma","to":"operator"},{"type":"tutor","to":"agents"}]' },
          ]);
        }),
    );
  }
});
