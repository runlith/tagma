import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { Clock, Context, Effect, FileSystem, Layer, Stream } from 'effect';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { bornThread } from '../../../native-harness/testing/born.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { storeLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { ThreadFeeds } from '../../../threads/contract/service/feeds.js';
import type { ViewSites } from '../../../views/contract/service/views.js';
import { makeRuntime } from '../../runtime.js';
import { COMPOSED } from '../composed.js';
import { fixtureMigrations } from '../migrations.js';

const FIXTURE = resolve(import.meta.dir, '../../../tagma-apps/testing/keyed.ts');
const TOKEN = 'tok-5678-carried';
const MIGRATION = '20261029174920_tagma_apps';
const THREAD = 'carried-thread';
const SITES: ViewSites['Service'] = { site: (app) => ({ _tag: 'served', origin: `https://${app}.example` }), moved: Stream.never };
const RECORDED = {
  type: 'tool',
  id: 'carried-tool',
  toolName: 'plugin__board__keyed',
  toolCallId: 'call-1',
  toolState: 'output-available',
  toolInput: {},
  toolOutput: 'keyed',
};

it.live(
  'a data directory the plugins build left opens with its app running from the carried place, its stored names carried and its recorded call shown by its view',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const data = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-apps-carry-' });
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-apps-carry-root-' });
      const databasePath = join(data, 'tagma.sqlite');
      const former = join(data, 'plugins', 'board');
      yield* files.makeDirectory(join(former, 'ui'), { recursive: true });
      yield* files.writeFileString(join(former, 'ui', 'board.html'), '<!doctype html><p>board</p>');
      yield* files.writeFileString(join(former, 'notes'), 'former');
      yield* files.writeFileString(
        join(former, 'plugin.json'),
        JSON.stringify({
          id: 'board',
          title: 'Board',
          process: { command: process.execPath, args: [FIXTURE] },
          contributes: {
            secrets: [{ name: 'API_TOKEN', description: 'The token of the board.' }],
            tools: [{ name: 'keyed', audience: 'agents' }],
            views: [{ id: 'board', entry: 'ui/board.html' }],
            results: [{ tool: 'keyed', view: 'board' }],
          },
        }),
      );
      yield* files.makeDirectory(join(data, 'apps', 'board'), { recursive: true });
      yield* files.writeFileString(join(data, 'apps', 'board', 'notes'), 'current');
      yield* files.makeDirectory(join(data, 'plugin-data', 'board'), { recursive: true });
      yield* files.writeFileString(join(data, 'plugin-data', 'board', 'kept'), 'kept by the plugin');
      yield* files.makeDirectory(join(data, 'app-data', 'board', 'view-storage'), { recursive: true });
      yield* files.writeFileString(join(data, 'app-data', 'board', 'view-storage', 'save'), 'saved');
      yield* files.writeFileString(
        join(data, 'secrets.json'),
        JSON.stringify({ owners: { plugins: { board: { values: { API_TOKEN: TOKEN } } } } }),
      );
      const now = yield* Clock.currentTimeMillis;
      const projectId = yield* Effect.scoped(
        Effect.gen(function* () {
          const { db } = Context.get(
            yield* Layer.build(storeLayer(MachineStore, databasePath, fixtureMigrations, { readers: 0 }, sharedPool)),
            MachineStore,
          );
          const made = yield* db
            .insert(project())
            .values({ name: 'board', repoKey: root, rootPath: root, createdAt: new Date(0) })
            .returning()
            .get();
          yield* db.run(sql.raw('ALTER TABLE `thread_view_pin` RENAME COLUMN `app` TO `plugin`'));
          yield* db.run(sql`DELETE FROM __drizzle_migrations WHERE name = ${MIGRATION}`);
          const installed = JSON.stringify([{ id: 'board', source: former, enabled: true }]);
          yield* db.run(
            sql`INSERT INTO setting (scope, project_id, key, value, declined, updated_at) VALUES ('user', NULL, 'plugins.installed', ${installed}, 0, 0)`,
          );
          yield* db.run(
            sql`INSERT INTO setting (scope, project_id, key, value, declined, updated_at) VALUES ('project', ${made!.id}, 'plugins.enabled', '["board"]', 0, 0)`,
          );
          yield* db.run(
            sql`INSERT INTO setting (scope, project_id, key, value, declined, updated_at) VALUES ('user', NULL, 'agent.approves', '["ask_user","plugin__board__keyed"]', 0, 0)`,
          );
          yield* bornThread(
            db,
            {
              id: THREAD,
              ownerId: 'operator',
              agentId: 'tagma',
              authority: { mode: 'trust', bypassFrom: null },
              profile: null,
              spawnRootId: THREAD,
              cacheGroup: THREAD,
              provider: 'openai-oauth',
              status: 'idle',
              createdAt: new Date(now),
              updatedAt: new Date(now),
            },
            { projectId: made!.id, title: 'carried' },
          );
          const profile = JSON.stringify({
            id: 'board.player',
            overlay: {
              id: 'board.player',
              baseAgentId: 'tagma',
              capabilities: ['files', 'plugin:board'],
              tools: ['read', 'plugin__board__keyed'],
            },
          });
          yield* db.run(sql`UPDATE native_thread SET profile = ${profile} WHERE id = ${THREAD}`);
          yield* db.run(
            sql`UPDATE thread_mandate SET approves = '["plugin__board__keyed"]', bindings = '{"plugin":"board"}' WHERE id = ${THREAD}`,
          );
          const entry = JSON.stringify(RECORDED);
          yield* db.run(
            sql`INSERT INTO thread_event (thread_id, position, id, kind, payload) VALUES (${THREAD}, 1, 'carried-event', 'tool', json_object('entry', json(${entry})))`,
          );
          yield* db.run(sql`INSERT INTO thread_log (thread_id, history_through, entries_through) VALUES (${THREAD}, 1, 1)`);
          yield* db.run(
            sql`INSERT INTO thread_entry (thread_id, ord, entry_id, type, entry) VALUES (${THREAD}, 0, ${RECORDED.id}, 'tool', ${entry})`,
          );
          yield* db.run(
            sql`INSERT INTO notification (id, sender, key, title, body, created_at) VALUES ('asked', 'plugin:board', 'deal', 'Deal?', 'A hand waits.', ${now})`,
          );
          yield* db.run(
            sql`INSERT INTO thread_call (actor, operation, key, thread_id, digest, result, at) VALUES ('external.plugin:board', 'input', 'turn-1', ${THREAD}, 'd', '{"answer":null}', ${now})`,
          );
          yield* db.run(
            sql`INSERT INTO spent_call_key (actor, operation, key, digest, spent_at) VALUES ('external.plugin:board', 'input', 'turn-0', 'd', ${now})`,
          );
          return made!.id;
        }),
      );

      const runtime = yield* makeRuntime(
        {
          ...COMPOSED,
          grants: testGrantSigner,
          databasePath,
          tokensPath: join(data, 'tokens.json'),
          attachmentsPath: join(data, 'attachments'),
          sourcePath: join(data, 'tagma'),
        },
        Layer.empty,
        yield* sharedPool,
      );
      yield* runtime.tagmaApps.start();

      expect(yield* runtime.tagmaApps.list(projectId)).toMatchObject([
        { id: 'board', floor: 'user', installed: { source: join(data, 'apps', 'board'), enabled: true }, enabled: true, state: 'running' },
      ]);
      const said = yield* runtime.tagmaApps.call('board', 'length', {}, {});
      expect('content' in said ? said.content[0] : undefined).toMatchObject({ type: 'text', text: String(TOKEN.length) });
      expect(JSON.parse(yield* files.readFileString(join(data, 'secrets.json')))).toEqual({
        owners: { 'tagma-apps': { board: { values: { API_TOKEN: TOKEN } } } },
      });
      expect(yield* files.readFileString(join(data, 'app-data', 'board', 'kept'))).toBe('kept by the plugin');
      expect(yield* files.readFileString(join(data, 'app-data', 'board', 'view-storage', 'save'))).toBe('saved');
      expect(yield* files.readFileString(join(data, 'app-data', 'board', 'journal'))).toContain('start ');
      expect(yield* files.exists(join(data, 'apps', 'board', 'tagma-app.json'))).toBe(true);
      expect([
        yield* files.readFileString(join(data, 'apps', 'board', 'notes')),
        yield* files.readFileString(join(former, 'notes')),
      ]).toEqual(['current', 'former']);
      expect([yield* files.exists(join(former, 'plugin.json')), yield* files.exists(join(data, 'plugin-data'))]).toEqual([false, false]);

      const [set] = yield* Stream.runCollect(
        runtime.views.sets(projectId, SITES).pipe(
          Stream.filter((state) => state.apps.length > 0),
          Stream.take(1),
        ),
      );
      const [frame] = yield* Stream.runCollect(
        Stream.take(Context.get(runtime.owners, ThreadFeeds)['thread.subscribe']({ projectId, threadId: THREAD }), 1),
      );
      const shown =
        frame?.type === 'snapshot'
          ? frame.payload.snapshot.transcript.flatMap((entry) => (coreEntry(entry) && entry.type === 'tool' ? [entry.toolName] : []))
          : [];
      expect({ shown, offered: set?.apps[0]?.results.map((result) => result.name) }).toEqual({
        shown: ['app__board__keyed'],
        offered: ['app__board__keyed'],
      });

      const { db } = Context.get(runtime.graph, MachineStore);
      const [stored] = yield* db.all<{
        readonly overlay: string;
        readonly approves: string;
        readonly bindings: string;
        readonly granted: string;
        readonly sender: string;
        readonly called: string;
        readonly spent: string;
      }>(sql`SELECT
        (SELECT json_extract(profile, '$.overlay') FROM native_thread WHERE id = ${THREAD}) AS overlay,
        (SELECT approves FROM thread_mandate WHERE id = ${THREAD}) AS approves,
        (SELECT bindings FROM thread_mandate WHERE id = ${THREAD}) AS bindings,
        (SELECT value FROM setting WHERE key = 'agent.approves') AS granted,
        (SELECT sender FROM notification WHERE id = 'asked') AS sender,
        (SELECT actor FROM thread_call WHERE key = 'turn-1') AS called,
        (SELECT actor FROM spent_call_key WHERE key = 'turn-0') AS spent`);
      expect({
        ...stored,
        overlay: JSON.parse(stored!.overlay),
        approves: JSON.parse(stored!.approves),
        bindings: JSON.parse(stored!.bindings),
        granted: JSON.parse(stored!.granted),
      }).toEqual({
        overlay: { id: 'board.player', baseAgentId: 'tagma', capabilities: ['files', 'app:board'], tools: ['read', 'app__board__keyed'] },
        approves: ['app__board__keyed'],
        bindings: { app: 'board' },
        granted: ['ask_user', 'app__board__keyed'],
        sender: 'app:board',
        called: 'external.app:board',
        spent: 'external.app:board',
      });
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
