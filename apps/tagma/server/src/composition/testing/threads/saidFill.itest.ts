import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Queue } from 'effect';
import type { ThreadMessageEntry } from '@runlith/agent/transcript/entries';
import { ProjectLifecycle } from '../../../graph/contract/service/serving.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { ThreadList, type ThreadsEvent } from '../../../threads/contract/service/list.js';
import { threadEntry, threadRun, birthsOf } from '../../../threads/testing/doubles.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { makeRuntime } from '../../runtime.js';
import { COMPOSED } from '../composed.js';
import { chosenModel } from '../chosenModel.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';

const setup = Effect.fn('testing.saidFillWorld')(function* () {
  const files = yield* FileSystem.FileSystem;
  const data = yield* files.makeTempDirectoryScoped({ prefix: 'said-fill-' });
  const rootPath = yield* files.makeTempDirectoryScoped({ prefix: 'said-fill-root-' });
  const processes = yield* sharedPool;
  const runtime = yield* makeRuntime(
    {
      ...COMPOSED,
      drivers: ['said-backfill'],
      grants: testGrantSigner,
      databasePath: join(data, 'tagma.sqlite'),
      tokensPath: join(data, 'tokens.json'),
      attachmentsPath: join(data, 'attachments'),
      sourcePath: join(data, 'tagma'),
    },
    Layer.empty,
    processes,
  );
  const project = yield* Context.get(runtime.graph, ProjectLifecycle)
    .create({ name: 'said', rootPath })
    .pipe(Effect.provide(runtime.owners));
  yield* chosenModel(runtime);
  return { runtime, projectId: project.id };
});

class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/SaidFillWorld') {}

const ended = Effect.fn('testing.endedSaidThread')(function* (title: string, role: ThreadMessageEntry['role'], text: string) {
  const { runtime, projectId } = yield* World;
  const db = Context.get(runtime.graph, MachineStore).db;
  const made = yield* birthsOf(runtime.owners).create({ projectId, createdBySessionId: null, title });
  const threadId = made.thread.id;
  const runId = `run-${threadId}`;
  const now = new Date(yield* Clock.currentTimeMillis);
  yield* db.insert(threadRun()).values({ id: runId, threadId, ownerId: 'operator', status: 'completed', finishedAt: now });
  const entry: ThreadMessageEntry = { type: 'message', id: `${threadId}-0`, runId, role, text, occurredAt: now.toISOString() };
  yield* db.insert(threadEntry()).values({ threadId, ord: 0, entryId: entry.id, runId, type: entry.type, entry });
  return threadId;
});

layer(Layer.effect(World, setup()).pipe(Layer.provide(BunFileSystem.layer)), { excludeTestServices: true })(
  'stored thread previews',
  (it) => {
    it.effect('opening maintenance publishes the previews of stored runs, including one with no assistant answer', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const list = Context.get(runtime.owners, ThreadList);
        const filled = yield* ended('filled', 'assistant', 'the line said\nmore');
        const silent = yield* ended('silent', 'user', 'nobody answered');
        expect((yield* list.row(filled))?.saidLine).toBeNull();
        const changes = yield* Effect.acquireRelease(Queue.unbounded<ThreadsEvent>(), Queue.shutdown);
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            list.subscribe(projectId, (event) => {
              Queue.offerUnsafe(changes, event);
            }),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
        yield* runtime.openMaintenance;
        const published = new Map<string, string | null>();
        while (published.size < 2) {
          const event = yield* Queue.take(changes);
          if (event.kind === 'row' && (event.row.id === filled || event.row.id === silent)) published.set(event.row.id, event.row.saidLine);
        }
        expect(published.get(filled)).toBe('the line said');
        expect(published.get(silent)).toBeNull();
        expect((yield* list.row(filled))?.saidLine).toBe('the line said');
        expect((yield* list.row(silent))?.saidLine).toBeNull();
      }),
    );
  },
);
