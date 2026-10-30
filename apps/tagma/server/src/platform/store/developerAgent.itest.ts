import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';

const MIGRATION = '20261017060000_developer_agent';

const CODE = [
  'agents',
  'files',
  'shell',
  'web',
  'mcp',
  'plugins',
  'skills',
  'threads',
  'peers',
  'resources',
  'sandbox',
  'worktrees',
  'terminals',
  'artifacts',
  'reflections',
];

layer(BunFileSystem.layer, { excludeTestServices: true })('stored code threads', (it) => {
  it.effect('opening moves code threads, their hosted bindings, derived profiles and settings onto developer without the graph', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-developer-agent-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      const move = join(folder, MIGRATION);
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(move);
      const isolated = JSON.stringify({
        id: 'code-isolated',
        overlay: { id: 'code-isolated', baseAgentId: 'code', description: 'd', capabilities: ['files', 'shell'] },
      });
      const scout = JSON.stringify({ id: 'scout', overlay: { id: 'scout', baseAgentId: 'code', description: 'd', instructions: 'Look.' } });
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE thread (id text PRIMARY KEY, agent_id text NOT NULL);',
          'CREATE TABLE native_thread (id text PRIMARY KEY, profile text, transport text NOT NULL);',
          'CREATE TABLE setting (id integer PRIMARY KEY, key text, value text);',
          "INSERT INTO thread VALUES ('plain', 'code'), ('hosted', 'harness'), ('isolated', 'code'), ('lead', 'tagma'), ('scout', 'code');",
          `INSERT INTO native_thread VALUES ('plain', null, '{"adapter":"native"}'), ('hosted', null, '{"adapter":"acp","profile":"claude","agent":"code"}'), ('isolated', '${isolated}', '{"adapter":"native"}'), ('lead', null, '{"adapter":"native"}'), ('scout', '${scout}', '{"adapter":"native"}');`,
          `INSERT INTO setting VALUES (1, 'agent.default', '"code"'), (2, 'agent.offered', '[{"type":"code","to":"operator"},{"type":"tutor","to":"agents"}]');`,
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(new URL(`../../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname, join(move, 'migration.sql'));
      const context = yield* Layer.build(
        storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
      );
      const { db } = Context.get(context, MachineStore);
      const rows = yield* db.all<{ id: string; agent: string; profile: string | null; transport: string }>(
        sql`select t.id, t.agent_id as agent, n.profile, n.transport from thread t join native_thread n on n.id = t.id order by t.id`,
      );
      const read = rows.map((row) => ({
        id: row.id,
        agent: row.agent,
        hosted: (JSON.parse(row.transport) as { agent?: string }).agent,
        profile:
          row.profile === null
            ? null
            : (JSON.parse(row.profile) as { id: string; overlay: { baseAgentId: string; capabilities: string[] } }),
      }));
      expect(
        read.map(({ id, agent, hosted, profile }) => [
          id,
          agent,
          hosted,
          profile?.id,
          profile?.overlay.baseAgentId,
          profile?.overlay.capabilities,
        ]),
      ).toEqual([
        ['hosted', 'harness', 'developer', 'developer', 'developer', CODE],
        ['isolated', 'developer', undefined, 'code-isolated', 'developer', ['files', 'shell']],
        ['lead', 'tagma', undefined, undefined, undefined, undefined],
        ['plain', 'developer', undefined, 'developer', 'developer', CODE],
        ['scout', 'developer', undefined, 'scout', 'developer', CODE],
      ]);
      expect(yield* db.all(sql`select id, value from setting order by id`)).toEqual([
        { id: 1, value: '"developer"' },
        { id: 2, value: '[{"type":"developer","to":"operator"},{"type":"tutor","to":"agents"}]' },
      ]);
    }),
  );
});
