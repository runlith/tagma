import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { MachineStore } from '../contract/service/store.js';
import { storeLayer } from './open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';

const MIGRATION = '20261018170000_hosted_selection';

const HOSTED = '{"adapter":"acp","profile":"claude","agent":"tagma"}';
const TERMINAL = '{"adapter":"terminal","profile":"claude","agent":null}';

layer(BunFileSystem.layer, { excludeTestServices: true })('stored Claude threads hosted over acp', (it) => {
  it.effect('opening gives every hosted Claude thread a model and rung, and drops the claude road from the transport setting', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-hosted-selection-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      const move = join(folder, MIGRATION);
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(move);
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE native_thread (id text PRIMARY KEY, provider text NOT NULL, model text, reasoning text, transport text NOT NULL);',
          'CREATE TABLE setting (id integer PRIMARY KEY, key text, value text, declined integer NOT NULL DEFAULT 0);',
          `INSERT INTO native_thread VALUES ('unnamed', 'claude-code', null, null, '${HOSTED}'), ('sonnet', 'claude-code', 'claude-sonnet-5-5', null, '${HOSTED}'), ('chosen', 'claude-code', 'claude-opus-5-5', 'max', '${HOSTED}'), ('terminal', 'claude-code', null, null, '${TERMINAL}');`,
          `INSERT INTO setting (id, key, value) VALUES (1, 'threads.harnessTransport', '{"claude":"acp","devin":"acp"}');`,
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(new URL(`../../../drizzle/${MIGRATION}/migration.sql`, import.meta.url).pathname, join(move, 'migration.sql'));
      const context = yield* Layer.build(
        storeLayer(MachineStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
      );
      const { db } = Context.get(context, MachineStore);
      expect(yield* db.all(sql`select id, model, reasoning from native_thread order by id`)).toEqual([
        { id: 'chosen', model: 'claude-opus-5-5', reasoning: 'max' },
        { id: 'sonnet', model: 'claude-sonnet-5-5', reasoning: 'high' },
        { id: 'terminal', model: null, reasoning: null },
        { id: 'unnamed', model: 'claude-opus-5-5', reasoning: 'medium' },
      ]);
      expect(yield* db.all(sql`select value from setting`)).toEqual([{ value: '{"devin":"acp"}' }]);
    }),
  );
});
