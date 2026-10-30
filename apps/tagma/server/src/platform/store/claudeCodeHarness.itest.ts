import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';

const MIGRATION = '20261018173000_claude_code_harness';

layer(BunFileSystem.layer, { excludeTestServices: true })('stored Claude Code harness identities', (it) => {
  it.effect('opening moves harness identities, profile references and settings while preserving provider and vendor session identity', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-claude-code-harness-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      const move = join(folder, MIGRATION);
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(move);
      const profile = JSON.stringify({
        id: 'harness:claude',
        overlay: { id: 'harness:claude', baseAgentId: 'harness:claude', capabilities: ['files'] },
      });
      const definition = JSON.stringify({ agentId: 'harness:claude', profile: JSON.parse(profile) });
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE thread (id text PRIMARY KEY, harness text NOT NULL, agent_id text NOT NULL);',
          'CREATE TABLE session (id integer PRIMARY KEY, harness text NOT NULL, key text NOT NULL);',
          'CREATE UNIQUE INDEX session_identity_idx ON session (harness, key);',
          "CREATE TABLE external_session (id text PRIMARY KEY, facet text NOT NULL, cli text GENERATED ALWAYS AS (json_extract(facet, '$.name')) VIRTUAL);",
          'CREATE TABLE native_thread (id text PRIMARY KEY, provider text NOT NULL, profile text, transport text NOT NULL, pending_definition text);',
          'CREATE TABLE setting (id integer PRIMARY KEY, key text, value text, declined integer NOT NULL DEFAULT 0);',
          "INSERT INTO thread VALUES ('cli', 'claude', 'harness'), ('typed', 'claude', 'harness:claude'), ('other', 'codex', 'harness');",
          "INSERT INTO session VALUES (1, 'claude', 'same-key'), (2, 'codex', 'same-key');",
          `INSERT INTO external_session (id, facet) VALUES ('cli', '{"name":"claude","sessionKey":"vendor-session"}'), ('other', '{"name":"codex","sessionKey":"other-session"}');`,
          `INSERT INTO native_thread VALUES ('cli', 'claude-code', '${profile}', '{"adapter":"acp","profile":"claude","agent":"harness:claude"}', '${definition}'), ('other', 'openai-oauth', null, '{"adapter":"terminal","profile":"codex","agent":null}', null);`,
          `INSERT INTO setting (id, key, value) VALUES (1, 'threads.harnessProfile', '{"claude":{"plain":true,"home":"/home/claude","permissionMode":"manual"},"codex":{"plain":false}}'), (2, 'agent.default', '"harness:claude"'), (3, 'agent.offered', '[{"type":"harness:claude","to":"agents"},{"type":"harness:codex","to":"operator"}]'), (4, 'agent.default', '"tagma"');`,
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(new URL(`../../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname, join(move, 'migration.sql'));
      const context = yield* Layer.build(
        storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
      );
      const { db } = Context.get(context, MachineStore);
      expect(yield* db.all(sql`select * from thread order by id`)).toEqual([
        { id: 'cli', harness: 'claude-code', agent_id: 'harness' },
        { id: 'other', harness: 'codex', agent_id: 'harness' },
        { id: 'typed', harness: 'claude-code', agent_id: 'harness:claude-code' },
      ]);
      expect(yield* db.all(sql`select * from session order by id`)).toEqual([
        { id: 1, harness: 'claude-code', key: 'same-key' },
        { id: 2, harness: 'codex', key: 'same-key' },
      ]);
      expect(
        yield* db.all(sql`select id, cli, json_extract(facet, '$.sessionKey') as sessionKey from external_session order by id`),
      ).toEqual([
        { id: 'cli', cli: 'claude-code', sessionKey: 'vendor-session' },
        { id: 'other', cli: 'codex', sessionKey: 'other-session' },
      ]);
      const rows = yield* db.all<{
        id: string;
        provider: string;
        profile: string | null;
        transport: string;
        pending_definition: string | null;
      }>(sql`select * from native_thread order by id`);
      const renamed = {
        id: 'harness:claude-code',
        overlay: { id: 'harness:claude-code', baseAgentId: 'harness:claude-code', capabilities: ['files'] },
      };
      expect(
        rows.map((row) => ({
          ...row,
          profile: row.profile === null ? null : JSON.parse(row.profile),
          transport: JSON.parse(row.transport),
          pending_definition: row.pending_definition === null ? null : JSON.parse(row.pending_definition),
        })),
      ).toEqual([
        {
          id: 'cli',
          provider: 'claude-code',
          profile: renamed,
          transport: { adapter: 'acp', profile: 'claude-code', agent: 'harness:claude-code' },
          pending_definition: { agentId: 'harness:claude-code', profile: renamed },
        },
        {
          id: 'other',
          provider: 'openai-oauth',
          profile: null,
          transport: { adapter: 'terminal', profile: 'codex', agent: null },
          pending_definition: null,
        },
      ]);
      const settings = yield* db.all<{ id: number; value: string }>(sql`select id, value from setting order by id`);
      expect(settings.map((row) => ({ id: row.id, value: JSON.parse(row.value) }))).toEqual([
        {
          id: 1,
          value: { 'claude-code': { plain: true, home: '/home/claude', permissionMode: 'manual' }, codex: { plain: false } },
        },
        { id: 2, value: 'harness:claude-code' },
        {
          id: 3,
          value: [
            { type: 'harness:claude-code', to: 'agents' },
            { type: 'harness:codex', to: 'operator' },
          ],
        },
        { id: 4, value: 'tagma' },
      ]);
    }),
  );
});
