import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer, Schedule } from 'effect';
import { eq } from 'drizzle-orm';
import type { ThreadMessageEntry } from '@runlith/agent/transcript/entries';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { threadEntry, threadEvent, threadRun, birthsOf, evidenceOf, listOf, rolloutsOf } from '../../../threads/testing/doubles.js';
import { restOf } from '../../../threads/testing/rest.js';
import { makeDoorWorld } from '../doorFixture.js';

const setup = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const world = yield* makeDoorWorld({ drivers: ['rollout-shelving'], own: 'the test opens the runtime maintenance gate once' });
  const runtime = world.runtime;
  const projectId = yield* world.stealthProject();
  return { files, data: world.dataHome, runtime, projectId, db: Context.get(runtime.graph, MachineStore).db };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/ShelfWorld') {}
const events = Effect.fnUntraced(function* (threadId: string) {
  const { db } = yield* World;
  return yield* db.select({ id: threadEvent().id }).from(threadEvent()).where(eq(threadEvent().threadId, threadId));
});
const shelved = Effect.fn('testing.threadShelved')(function* (threadId: string) {
  const { db } = yield* World;
  yield* Effect.gen(function* () {
    return (yield* restOf(db, threadId)) !== null && (yield* events(threadId)).length === 0;
  }).pipe(Effect.repeat({ while: (done) => !done, schedule: Schedule.spaced(25) }));
});
const resident = Effect.fn('testing.residentRollout')(function* (title: string) {
  const { files, data, runtime, projectId, db } = yield* World;
  const threadId = (yield* birthsOf(runtime.owners).create({ projectId, createdBySessionId: null, title })).thread.id;
  const path = join(data, 'threads', String(projectId), `${threadId}.jsonl`);
  const rollouts = rolloutsOf(runtime.owners);
  yield* rollouts.ensure(threadId);
  const entry: ThreadMessageEntry = {
    type: 'message',
    id: `said-${threadId}`,
    runId: `run-${threadId}`,
    role: 'assistant',
    text: `${title}\nmore`,
  };
  yield* files.writeFileString(
    path,
    `${JSON.stringify({ kind: 'event', row: { threadId, position: 1, id: `ev-${threadId}`, kind: 'message', payload: { entry } } })}\n`,
    { flag: 'a' },
  );
  yield* files.makeDirectory(join(data, 'threads', '.pending'), { recursive: true });
  yield* files.writeFileString(join(data, 'threads', '.pending', threadId), path);
  yield* rollouts.replay();
  yield* db.insert(threadRun()).values({
    id: entry.runId,
    threadId,
    ownerId: 'operator',
    status: 'completed',
    finishedAt: new Date(yield* Clock.currentTimeMillis),
    saidFinal: entry.text,
  });
  yield* db.insert(threadEntry()).values({ threadId, ord: 0, entryId: entry.id, runId: entry.runId, type: 'message', entry });
  return threadId;
});

layer(Layer.effect(World, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'rested rollout maintenance',
  (it) => {
    it.effect('shelves archived payloads only after maintenance starts, preserves reads and said, and waits for the last user', () =>
      Effect.gen(function* () {
        const { runtime, projectId, db } = yield* World;
        const rollouts = rolloutsOf(runtime.owners);
        const list = listOf(runtime.owners);
        const threadId = yield* resident('the archived thread');
        const said = (yield* list.row(threadId))?.saidLine;
        expect(said).toBe('the archived thread\nmore');
        const evidence = evidenceOf(runtime.owners);
        const feed = (yield* evidence.entries(threadId, projectId, Number.MAX_SAFE_INTEGER)).entries.map((entry) => entry.id);
        yield* list.setArchived(threadId, projectId, true);
        expect((yield* events(threadId)).map((row) => row.id)).toEqual([`ev-${threadId}`]);
        expect(yield* restOf(db, threadId)).toBeNull();
        yield* runtime.openMaintenance;
        yield* shelved(threadId);
        expect((yield* evidence.entries(threadId, projectId, Number.MAX_SAFE_INTEGER)).entries.map((entry) => entry.id)).toEqual(feed);
        expect((yield* list.row(threadId))?.saidLine).toBe(said);
        yield* rollouts.rehydrate(threadId);
        expect((yield* events(threadId)).map((row) => row.id)).toEqual([`ev-${threadId}`]);
        yield* evidence.shape(threadId, projectId);
        yield* shelved(threadId);
        const busy = yield* resident('the busy archived thread');
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const reading = yield* Effect.forkScoped(
          rollouts.using(busy, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))),
        );
        yield* Deferred.await(entered);
        yield* list.setArchived(busy, projectId, true);
        expect(yield* rollouts.evict(projectId, busy)).toEqual({ outcome: 'kept', reason: 'in-use' });
        expect((yield* events(busy)).map((row) => row.id)).toEqual([`ev-${busy}`]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(reading);
        yield* shelved(busy);
      }),
    );
  },
);
