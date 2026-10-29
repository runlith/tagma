import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../platform/contract/service/store.js';
import { storeLayer } from '../platform/store/open.js';

const MIGRATION = '20261029232336_mcp_connector_mark';

const linear = {
  name: 'linear',
  transport: 'http',
  url: 'https://mcp.linear.app/mcp',
  capabilities: { kinds: ['network'], mutates: true },
  enabled: true,
  version: 1,
};
const own = { name: 'own', transport: 'stdio', command: 'own-server', capabilities: { kinds: ['read'], mutates: false }, enabled: false };
const notion = { ...linear, name: 'notion', url: 'https://mcp.notion.com/mcp' };

layer(BunFileSystem.layer, { excludeTestServices: true })('connector mark', (it) => {
  it.effect(
    'opening drops the connector mark from every declared MCP server and leaves every member, layer and decline otherwise as it stood',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-connector-mark-' });
        const folder = join(root, 'drizzle');
        const base = join(folder, '20260101000000_base');
        const step = join(folder, MIGRATION);
        yield* files.makeDirectory(base, { recursive: true });
        yield* files.makeDirectory(step);
        const marked = (declaration: object, connector: string) => JSON.stringify({ ...declaration, connector });
        yield* files.writeFileString(
          join(base, 'migration.sql'),
          [
            'CREATE TABLE setting (id integer PRIMARY KEY, scope text, project_id integer, key text, value text, declined integer);',
            `INSERT INTO setting VALUES (1, 'user', null, 'mcp.servers', '[${marked(linear, 'linear')},${JSON.stringify(own)},null,"stray",7,false,[1]]', 0);`,
            `INSERT INTO setting VALUES (2, 'project', 7, 'mcp.servers', '[${marked(notion, 'notion')}]', 1);`,
            `INSERT INTO setting VALUES (3, 'project', 8, 'mcp.servers', null, 1);`,
            `INSERT INTO setting VALUES (4, 'user', null, 'agent.models', '[{"provider":"a","connector":"kept"}]', 0);`,
          ].join('\n--> statement-breakpoint\n'),
        );
        yield* files.copyFile(new URL(`../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname, join(step, 'migration.sql'));
        const context = yield* Layer.build(
          storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
        );
        const { db } = Context.get(context, MachineStore);
        const settings = yield* db.all<{ id: number; value: string | null; declined: number }>(
          sql`select id, value, declined from setting order by id`,
        );
        expect(settings.map((row) => [row.id, row.value === null ? null : JSON.parse(row.value), row.declined])).toEqual([
          [1, [linear, own, null, 'stray', 7, false, [1]], 0],
          [2, [notion], 1],
          [3, null, 1],
          [4, [{ provider: 'a', connector: 'kept' }], 0],
        ]);
      }),
  );
});
