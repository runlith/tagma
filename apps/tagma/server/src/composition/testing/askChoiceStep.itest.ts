import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, Exit, FileSystem, Layer, Schema, Scope } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { endHosts } from '../../executions/testing/doubles.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { knownAnswer } from '../../platform/contract/wire/operation.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { SETTINGS_OPERATIONS } from '../../settings/contract/wire/operations.js';
import { doorLayer } from '../http/door.js';
import { makeRuntime } from '../runtime.js';
import { COMPOSED } from './composed.js';
import { TESTING_ADAPTERS } from './adapters.js';
import { doorServing } from './doorServices.js';
import { hostBundleRoot } from './hostBundle.js';
import { requestEffect } from './httpRequest.js';

const ORIGIN = 'http://tagma';
const STEP = '20261030150000_ask_choice';
const ROLES = ['translation.model', 'threads.titleModel', 'threads.decisionModel'];

const booted = Effect.fnUntraced(function* (home: string) {
  const scope = yield* Scope.make();
  const runtime = yield* makeRuntime(
    {
      ...COMPOSED,
      adapters: TESTING_ADAPTERS,
      grants: testGrantSigner,
      databasePath: join(home, 'tagma.sqlite'),
      tokensPath: join(home, 'tokens.json'),
      attachmentsPath: join(home, 'attachments'),
      sourcePath: join(home, 'source'),
      hostBundlePath: yield* Effect.orDie(hostBundleRoot),
      drivers: [],
      localOrigin: ORIGIN,
    },
    Layer.empty,
    yield* sharedPool,
  ).pipe(Scope.provide(scope), Effect.orDie);
  const routed = routedContext(runtime.graph, runtime.pool);
  const handler = yield* HttpRouter.toHttpEffect(
    doorServing(doorLayer({ status: runtime.status, routes: runtime.routes }), runtime, home).pipe(
      Layer.provide(frozenBuildsLayer({ dataPath: home })),
      Layer.provide(Layer.succeedContext(routed)),
      Layer.provide(Layer.succeedContext(runtime.bindings)),
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(HttpPlatform.layer),
      Layer.provideMerge(BunFileSystem.layer),
    ),
  ).pipe(Scope.provide(scope));
  const files = yield* FileSystem.FileSystem;
  const op = (id: string, input: unknown) =>
    Effect.provide(
      requestEffect(
        Effect.provideService(handler, FileSystem.FileSystem, files),
        new Request(`${ORIGIN}/api/op/${id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      ),
      routed,
    );
  return { op, close: Scope.close(scope, Exit.void) };
});

it.live(
  'role models stored with their separate rungs read back through read_settings as one choice each, and a value naming no model as a rejection',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'ask-choice-step-' });
      yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
      const data = join(home, 'data');
      const project = Effect.fnUntraced(function* (door: Effect.Success<ReturnType<typeof booted>>, name: string) {
        const root = join(home, name);
        yield* files.makeDirectory(root, { recursive: true });
        yield* spawnedEffect(['git', 'init', '-q', '-b', 'main'], { cwd: root });
        return ((yield* door.op('add_project', { name, rootPath: root, storage: 'stealth' })).body as { project: { id: number } }).project
          .id;
      });

      const first = yield* booted(data);
      const seven = yield* project(first, 'seven');
      const eight = yield* project(first, 'eight');
      yield* first.close;

      yield* Effect.sync(() => {
        const db = new Database(join(data, 'tagma.sqlite'));
        try {
          const stored = db.query('INSERT INTO setting (scope, project_id, key, value, declined, updated_at) VALUES (?, ?, ?, ?, 0, 1)');
          for (const [scope, projectId, key, value] of [
            ['user', null, 'translation.model', '"openai-oauth:gpt-5.5"'],
            ['user', null, 'translation.reasoning', '"low"'],
            ['project', seven, 'translation.model', '""'],
            ['user', null, 'threads.titleModel', '"subscription:claude-haiku-5-5"'],
            ['project', seven, 'threads.titleReasoning', '"high"'],
            ['user', null, 'threads.decisionModel', '"retired-model"'],
            ['user', null, 'threads.decisionReasoning', '"medium"'],
            ['project', eight, 'threads.decisionModel', '"openrouter:judge"'],
          ] as const)
            stored.run(scope, projectId, key, value);
          db.run('DELETE FROM __drizzle_migrations WHERE name = ?', [STEP]);
        } finally {
          db.close();
        }
      });

      const second = yield* booted(data);
      yield* Effect.addFinalizer(() => second.close);
      const read = Effect.fnUntraced(function* (name: string) {
        const answer = yield* Schema.decodeUnknownEffect(knownAnswer(SETTINGS_OPERATIONS.read_settings.answer))(
          (yield* second.op('read_settings', { project: name })).body,
        );
        if (answer.status !== 'ok') return yield* Effect.die(`read_settings answered ${answer.status}`);
        const { entries, rejections } = answer.settings;
        return {
          values: Object.fromEntries(entries.filter((entry) => ROLES.includes(entry.id)).map((entry) => [entry.id, entry.value])),
          user: Object.fromEntries(
            entries.filter((entry) => ROLES.includes(entry.id)).map((entry) => [entry.id, entry.layers.user?.value]),
          ),
          rejected: rejections.filter((rejection) => ROLES.includes(rejection.key)).map(({ key, scope }) => ({ key, scope })),
        };
      });

      const inSeven = yield* read('seven');
      expect(inSeven.values).toEqual({
        'translation.model': null,
        'threads.titleModel': { provider: 'subscription', model: 'claude-haiku-5-5', reasoning: 'high' },
        'threads.decisionModel': null,
      });
      expect(inSeven.user['translation.model']).toEqual({ provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'low' });
      expect(inSeven.rejected).toEqual([{ key: 'threads.decisionModel', scope: 'user' }]);
      expect((yield* read('eight')).values['threads.decisionModel']).toEqual({
        provider: 'openrouter',
        model: 'judge',
        reasoning: 'medium',
      });
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
