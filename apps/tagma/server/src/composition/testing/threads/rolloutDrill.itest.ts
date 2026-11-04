import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import {
  thread,
  threadEvent,
  threadRun,
  idleProjectionDays,
  threadScratch,
  birthsOf,
  evidenceOf,
  listOf,
  rolloutsOf,
} from '../../../threads/testing/doubles.js';
import { restOf } from '../../../threads/testing/rest.js';
import { threadToolOutputStore } from '../../../native-harness/testing/doubles.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';

const fixture = doorFixture();
const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const projectId = yield* world.stealthProject();
  yield* projectLeaving(world, projectId);
  return { data: world.dataHome, projectId, runtime: world.runtime };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/RolloutDrillWorld') {}

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture), Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'cold rollout lifecycle',
  (it) => {
    it.effect('the sweep preserves fresh and running threads, releases cold holdings, and returns later file records once', () =>
      Effect.gen(function* () {
        const { data, projectId, runtime } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const { db } = Context.get(runtime.graph, MachineStore);
        const rollouts = rolloutsOf(runtime.owners);
        const scratch = yield* threadScratch(join(data, 'scratch'));
        const outputs = threadToolOutputStore(join(data, 'tool-outputs'));
        const pathOf = (id: string) => join(data, 'threads', String(projectId), `${id}.jsonl`);
        const events = (id: string) => db.select().from(threadEvent()).where(eq(threadEvent().threadId, id));
        const window = (days: number) =>
          Context.get(runtime.graph, Settings).write({ scope: 'project', projectId, key: idleProjectionDays().id, value: days });
        const held = Effect.fnUntraced(function* (title: string, hours: number) {
          const id = (yield* birthsOf(runtime.owners).create({ projectId, createdBySessionId: null, title })).thread.id;
          yield* rollouts.ensure(id);
          yield* files.writeFileString(
            pathOf(id),
            `${JSON.stringify({ kind: 'event', row: { threadId: id, position: 1, id: `ev-${id}`, kind: 'message', payload: { entry: { type: 'message', id: `ev-${id}`, role: 'user', text: title } } } })}\n`,
            { flag: 'a' },
          );
          const pending = join(data, 'threads', '.pending');
          yield* files.makeDirectory(pending, { recursive: true });
          yield* files.writeFileString(join(pending, id), pathOf(id));
          yield* rollouts.replay();
          yield* db
            .update(thread())
            .set({ updatedAt: new Date((yield* Clock.currentTimeMillis) - hours * 60 * 60 * 1_000) })
            .where(eq(thread().id, id));
          yield* scratch.ensure(id);
          yield* files.writeFileString(join(scratch.directory(id), 'draft'), 'unfinished work');
          const answer = 'x'.repeat(WIRE_ENTRY_MAX_BYTES + 1);
          yield* outputs.scope({ threadId: id, ownerId: 'owner', runId: null }).project({
            toolCallId: `call-${id}`,
            toolName: 'bash',
            output: answer,
            modelOutput: { type: 'text', value: answer },
            keep: 'head',
          });
          expect(yield* files.exists(join(data, 'tool-outputs', id))).toBe(true);
          return id;
        });
        const cold = yield* held('the cold thread', 48);
        const fresh = yield* held('the fresh thread', 1);
        yield* listOf(runtime.owners).setArchived(fresh, projectId, true);
        const busy = yield* held('the running thread', 48);
        const runId = `run-${busy}`;
        yield* Effect.acquireRelease(
          db.insert(threadRun()).values({ id: runId, threadId: busy, ownerId: 'operator', status: 'running' }),
          () =>
            Effect.gen(function* () {
              yield* db
                .update(threadRun())
                .set({ status: 'aborted', finishedAt: new Date(yield* Clock.currentTimeMillis) })
                .where(eq(threadRun().id, runId));
            }).pipe(Effect.orDie),
        );
        expect(yield* rollouts.evict(projectId, busy)).toEqual({ outcome: 'kept', reason: 'running' });
        yield* window(0);
        expect((yield* rollouts.sweep()).off).toContain(projectId);
        expect((yield* events(cold)).map((row) => row.id)).toEqual([`ev-${cold}`]);
        yield* window(1);
        const swept = yield* rollouts.sweep();
        expect(swept.evicted).toContain(cold);
        for (const id of [fresh, busy]) {
          expect(swept.evicted).not.toContain(id);
          expect((yield* events(id)).map((row) => row.id)).toEqual([`ev-${id}`]);
          expect(yield* files.readDirectory(scratch.directory(id))).toEqual(['draft']);
          expect(yield* files.exists(join(data, 'tool-outputs', id))).toBe(true);
        }
        expect(yield* events(cold)).toEqual([]);
        expect(yield* restOf(db, cold)).not.toBeNull();
        expect(yield* files.exists(scratch.directory(cold))).toBe(false);
        expect(yield* files.exists(join(data, 'tool-outputs', cold))).toBe(false);
        const path = pathOf(cold);
        expect(yield* rollouts.report(cold, projectId)).toMatchObject({ path: `${path}.zst`, fileForm: 'compressed', refusal: null });
        expect(yield* files.exists(path)).toBe(false);
        expect((yield* evidenceOf(runtime.owners).shape(cold, projectId)).shape.entries).toBe(1);
        expect(yield* events(cold)).toEqual([]);
        expect(yield* restOf(db, cold)).not.toBeNull();
        const packed = yield* files.readFile(`${path}.zst`);
        yield* files.writeFile(path, yield* Effect.try(() => zstdDecompressSync(packed)));
        yield* files.writeFileString(
          path,
          `${JSON.stringify({ kind: 'event', row: { threadId: cold, position: 2, id: `ev2-${cold}`, kind: 'message', payload: { entry: { type: 'message', id: `ev2-${cold}`, role: 'user', text: 'said after the thaw' } } } })}\n`,
          { flag: 'a' },
        );
        const pending = join(data, 'threads', '.pending');
        yield* files.writeFileString(join(pending, cold), path);
        yield* rollouts.replay();
        expect(yield* events(cold)).toEqual([]);
        yield* rollouts.rehydrate(cold);
        yield* rollouts.rehydrate(cold);
        expect((yield* events(cold)).map((row) => row.id)).toEqual([`ev-${cold}`, `ev2-${cold}`]);
        expect(yield* restOf(db, cold)).toBeNull();
        expect(yield* files.readDirectory(scratch.directory(cold))).toEqual([]);
        yield* window(0);
      }),
    );
  },
);
