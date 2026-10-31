import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import {
  threadEvent,
  threadRolloutCursor,
  threadProjection,
  isThreadProjectionRefused,
  threadRolloutRepair,
} from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../composed.js';

const threadId = 'thread-under-repair';
const meta = () => `${JSON.stringify({ thread: { id: threadId }, facet: null, session: null })}\n`;
const event = (position: number, id: string) =>
  `${JSON.stringify({ kind: 'event', row: { threadId, position, id, kind: 'message', payload: { withdrawn: { runId: id, keepMessages: 0 } } } })}\n`;
const lineSchema = Schema.fromJsonString(
  Schema.Struct({
    kind: Schema.optional(Schema.String),
    row: Schema.optional(Schema.Struct({ position: Schema.Int, id: Schema.String, payload: Schema.Unknown })),
  }),
);
const stand = Effect.fn('testing.repairWorld')(function* () {
  const fixture = yield* threadStoreFixture;
  const runtime = Context.merge(fixture.context, yield* Layer.build(BunFileSystem.layer));
  const { db } = Context.get(runtime, MachineStore);
  const files = Context.get(runtime, FileSystem.FileSystem);
  yield* bornThread(
    db,
    {
      id: threadId,
      ownerId: 'operator',
      agentId: 'tagma',
      spawnRootId: threadId,
      cacheGroup: threadId,
      authority: THREAD_AUTHORITY_DEFAULT,
    },
    { projectId: fixture.projectId },
  );
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-rollout-repair-' });
  const path = join(home, String(fixture.projectId), `${threadId}.jsonl`);
  yield* files.makeDirectory(dirname(path), { recursive: true });
  yield* files.writeFileString(path, meta());
  const projection = yield* Effect.provide(threadProjection(ENTRY_KINDS), runtime);
  const repairs = yield* Effect.provide(threadRolloutRepair(ENTRY_KINDS), runtime);
  const records = Effect.gen(function* () {
    const text = yield* files.readFileString(path);
    const whole = text.split('\n');
    if (!text.endsWith('\n')) whole.pop();
    const lines = yield* Effect.forEach(whole.filter(Boolean), (line) => Schema.decodeUnknownEffect(lineSchema)(line));
    return lines.flatMap((line) => (line.kind === 'event' && line.row !== undefined ? [line.row] : []));
  }).pipe(Effect.withSpan('testing.repairedRolloutRecords'));
  return {
    files,
    path,
    records,
    append: (text: string) => files.writeFileString(path, text, { flag: 'a' }),
    repair: () => Effect.provide(repairs.repair({ threadId, path }), runtime),
    refused: () =>
      Effect.provide(
        Effect.flip(repairs.repair({ threadId, path })).pipe(
          Effect.flatMap((failure) => (isThreadProjectionRefused(failure) ? Effect.succeed(failure) : Effect.die(failure))),
        ),
        runtime,
      ),
    boot: () =>
      Effect.provide(
        projection.run({ threadId, path }).pipe(
          Effect.catch((failure) => projection.record(failure)),
          Effect.asVoid,
        ),
        runtime,
      ),
    rows: () => db.select().from(threadEvent()).where(eq(threadEvent().threadId, threadId)),
    cursor: () => db.select().from(threadRolloutCursor()).where(eq(threadRolloutCursor().threadId, threadId)).get(),
  };
});

describe('repair renumbers the file and reruns the pass', () => {
  it.live('1,2,2,3 becomes 1,2,3,4 without changing payload, identity or order', () =>
    Effect.gen(function* () {
      const world = yield* stand();
      yield* world.append(`${event(1, 'a')}${event(2, 'b')}${event(2, 'b-again')}${event(3, 'c')}`);
      const before = yield* world.records;
      const original = yield* world.files.readFileString(world.path);
      yield* world.boot();
      const done = yield* world.repair();
      expect(done.records).toBe(5);
      expect(done.renumbered).toBe(2);
      const after = yield* world.records;
      expect(after.map((row) => row.position)).toEqual([1, 2, 3, 4]);
      expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
      expect(after.map((row) => row.payload)).toEqual(before.map((row) => row.payload));
      expect(yield* world.files.readFileString(done.kept)).toBe(original);
      expect(yield* world.cursor()).toMatchObject({ nextByteOffset: 0, nextPosition: 1, generation: 1 });
      yield* world.boot();
      expect((yield* world.rows()).map((row) => row.position).sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
      expect((yield* world.rows()).map((row) => row.id)).toEqual(['a', 'b', 'b-again', 'c']);
    }),
  );
  it.live('a corrupt line refuses repair without changing the file', () =>
    Effect.gen(function* () {
      const world = yield* stand();
      yield* world.append(`${event(1, 'a')}this line is not json\n${event(1, 'a-again')}`);
      const original = yield* world.files.readFileString(world.path);
      yield* world.boot();
      expect((yield* world.refused()).reason).toBe('corrupt');
      expect(yield* world.files.readFileString(world.path)).toBe(original);
    }),
  );
  it.live('a payload refused by its schema stops the repair without changing the file', () =>
    Effect.gen(function* () {
      const world = yield* stand();
      yield* world.append(event(1, 'a'));
      yield* world.append(
        `${JSON.stringify({ kind: 'event', row: { threadId, position: 1, id: 'bad', kind: 'message', payload: 'not an object' } })}\n`,
      );
      const original = yield* world.files.readFileString(world.path);
      expect((yield* world.refused()).reason).toBe('corrupt');
      expect(yield* world.files.readFileString(world.path)).toBe(original);
    }),
  );
  it.live('records without a position and a torn tail keep their bytes', () =>
    Effect.gen(function* () {
      const world = yield* stand();
      const checkpoint = JSON.stringify({ kind: 'checkpoint', at: 'here' });
      const torn = '{"kind":"event","row":{"posi';
      yield* world.append(`${event(1, 'a')}${checkpoint}\n${event(1, 'a-again')}${torn}`);
      const done = yield* world.repair();
      const text = yield* world.files.readFileString(world.path);
      const lines = text.split('\n');
      expect(lines[0]).toBe(meta().trim());
      expect(lines[2]).toBe(checkpoint);
      expect((yield* world.records).map((row) => row.position)).toEqual([1, 2]);
      expect(text.endsWith(torn)).toBe(true);
      expect(done.renumbered).toBe(1);
    }),
  );
  it.live('a file already in sequence has no renumbered records', () =>
    Effect.gen(function* () {
      const world = yield* stand();
      yield* world.append(`${event(1, 'a')}${event(2, 'b')}`);
      expect((yield* world.repair()).renumbered).toBe(0);
      expect((yield* world.records).map((row) => row.position)).toEqual([1, 2]);
    }),
  );
});
