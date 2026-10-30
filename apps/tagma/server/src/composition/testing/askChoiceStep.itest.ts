import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { GraphStore } from '../../platform/contract/service/store.js';
import { storeLayer } from '../../platform/store/open.js';
import { resolveCatalog } from '../../settings/resolution.js';
import { valueRows } from '../../settings/store/rows.js';
import { decisionModel, titleModel } from '../../threads/contract/wire/settings.js';
import { translationModel } from '../../translations/contract/wire/settings.js';

const STEP = '20261030150000_ask_choice';
const KEYS = [translationModel, titleModel, decisionModel];

const OLD = [
  ['user', null, 'translation.model', '"openai-oauth:gpt-5.5"'],
  ['user', null, 'translation.reasoning', '"low"'],
  ['project', 7, 'translation.model', '""'],
  ['user', null, 'threads.titleModel', '"subscription:claude-haiku-5-5"'],
  ['project', 7, 'threads.titleReasoning', '"high"'],
  ['user', null, 'threads.decisionModel', '"retired-model"'],
  ['user', null, 'threads.decisionReasoning', '"medium"'],
  ['project', 8, 'threads.decisionModel', '"openrouter:judge"'],
  ['user', null, 'agent.web', '"tagma"'],
] as const;

layer(BunFileSystem.layer, { excludeTestServices: true })('role models stored before the ask choice', (it) => {
  it.effect('read back as one model and rung each, and a value that names no model stands as a rejection', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-ask-choice-' });
      const folder = join(root, 'drizzle');
      const base = join(folder, '20260101000000_base');
      yield* files.makeDirectory(base, { recursive: true });
      yield* files.makeDirectory(join(folder, STEP));
      yield* files.writeFileString(
        join(base, 'migration.sql'),
        [
          'CREATE TABLE setting (id integer PRIMARY KEY AUTOINCREMENT, scope text NOT NULL, project_id integer, key text NOT NULL, value text, declined integer NOT NULL DEFAULT 0, session_id integer, updated_at integer NOT NULL);',
          ...OLD.map(
            ([scope, project, key, value]) =>
              `INSERT INTO setting (scope, project_id, key, value, updated_at) VALUES ('${scope}', ${project ?? 'NULL'}, '${key}', '${value}', 1);`,
          ),
        ].join('\n--> statement-breakpoint\n'),
      );
      yield* files.copyFile(
        new URL(`../../../drizzle/${STEP}/migration.sql`, import.meta.url).pathname,
        join(folder, STEP, 'migration.sql'),
      );
      const context = yield* Layer.build(
        storeLayer(GraphStore, join(root, 'machine.sqlite'), { folder, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool),
      );
      const { db } = Context.get(context, GraphStore);
      const read = (projectId: number) => Effect.map(valueRows(db, projectId), (chain) => resolveCatalog(KEYS, chain));

      const seven = yield* read(7);
      expect(Object.fromEntries(seven.entries.map((entry) => [entry.id, entry.value]))).toEqual({
        'translation.model': null,
        'threads.titleModel': { provider: 'subscription', model: 'claude-haiku-5-5', reasoning: 'high' },
        'threads.decisionModel': null,
      });
      expect(seven.rejections).toEqual([expect.objectContaining({ key: 'threads.decisionModel', scope: 'user' })]);
      expect(seven.entries.find((entry) => entry.id === 'translation.model')?.layers.user?.value).toEqual({
        provider: 'openai-oauth',
        model: 'gpt-5.5',
        reasoning: 'low',
      });

      const eight = yield* read(8);
      expect(eight.entries.find((entry) => entry.id === 'threads.decisionModel')?.value).toEqual({
        provider: 'openrouter',
        model: 'judge',
        reasoning: 'medium',
      });
      expect(yield* db.all(sql`select key from setting where key like '%easoning' or key = 'agent.web'`)).toEqual([{ key: 'agent.web' }]);
    }),
  );
});
