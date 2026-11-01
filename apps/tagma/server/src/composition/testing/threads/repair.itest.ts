import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { eq, sql } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import {
  threadEvent,
  threadRolloutCursor,
  threadProjection,
  isThreadProjectionRefused,
  threadRolloutRepair,
  evictThreadProjection,
  journalSources,
} from '../../../threads/testing/doubles.js';
import { restFor } from '../../../threads/testing/rest.js';
import { ENTRY_KINDS } from '../composed.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';

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
  const repairs = yield* Effect.provide(threadRolloutRepair(ENTRY_KINDS, home, (yield* nativeOnlyParts).native.folds), runtime);
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
    evict: () =>
      Effect.flatMap(nativeOnlyParts, (parts) =>
        Effect.provide(
          evictThreadProjection({ threadId, path, parts }).pipe(Effect.provideService(ThreadEntryKinds, ENTRY_KINDS)),
          runtime,
        ),
      ),
    source: () =>
      db.all<{ generation: string; position: number; origin: string }>(
        sql`select generation, position, origin from thread_published_source where thread_id = ${threadId}`,
      ),
    adopt: Effect.fnUntraced(function* () {
      yield* restFor(db, threadId, new Date(0));
      const sources = yield* Effect.provide(journalSources(ENTRY_KINDS, home, (yield* nativeOnlyParts).native.folds), runtime);
      yield* Effect.provide(sources.using(threadId, sources.prepare(threadId)), runtime);
    }),
    index: Effect.fnUntraced(function* (positions: readonly number[]) {
      for (const position of positions)
        yield* db.run(sql`insert into thread_message (thread_id, entry_id, position, appeared, role, occurred_at, text)
          values (${threadId}, ${`m-${position}`}, ${position}, 0, 'user', 0, 'said')`);
      const through = Math.max(...positions);
      yield* db.run(sql`insert into thread_conversation (thread_id, through, seen) values (${threadId}, ${through}, ${through})
        on conflict (thread_id) do update set through = excluded.through, seen = excluded.seen`);
    }),
    conversation: () =>
      db.all(sql`select (select count(*) from thread_message where thread_id = ${threadId}) as indexed, through, seen
        from thread_conversation where thread_id = ${threadId}`),
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
  it.live('repairing an offloaded thread publishes its renumbered source with the cursor it resets', () =>
    Effect.gen(function* () {
      const world = yield* stand();
      yield* world.append(`${event(1, 'a')}${event(2, 'b')}`);
      yield* world.boot();
      expect(yield* world.evict()).toMatchObject({ outcome: 'evicted' });
      const [before] = yield* world.source();
      yield* world.repair();
      const [after] = yield* world.source();
      expect(after).toMatchObject({ origin: 'repair', position: 2 });
      expect(after!.generation).not.toBe(before!.generation);
      expect(yield* world.cursor()).toMatchObject({ nextByteOffset: 0, nextPosition: 1 });
    }),
  );
  it.live('repairing an adopted rested journal that skipped a position takes its conversation index off the old positions', () =>
    Effect.gen(function* () {
      const world = yield* stand();
      const said = (position: number, id: string) =>
        `${JSON.stringify({
          kind: 'event',
          row: { threadId, position, id, kind: 'message', payload: { entry: { type: 'message', id: `${id}:m`, role: 'user', text: id } } },
        })}\n`;
      yield* world.append(`${said(1, 'first')}${said(3, 'second')}`);
      yield* world.adopt();
      expect(yield* world.source()).toMatchObject([{ origin: 'adopted', position: 3 }]);
      yield* world.index([1, 3]);
      yield* world.repair();
      expect(yield* world.source()).toMatchObject([{ origin: 'repair', position: 2 }]);
      expect(yield* world.conversation()).toEqual([{ indexed: 0, through: 0, seen: 3 }]);
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
