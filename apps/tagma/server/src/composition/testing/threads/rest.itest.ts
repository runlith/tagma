import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import {
  threadProjection,
  evictThreadProjection,
  threadEvent,
  threadRolloutCursor,
  exportThreadRollout,
  rehydrateThreadRecords,
} from '../../../threads/testing/doubles.js';
import { project } from '../../../projects/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { recordOf } from '../../../thread-record/testing/records.js';
import { restOf } from '../../../threads/testing/rest.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { ENTRY_KINDS } from '../composed.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';

const rested = new Date('2026-08-25T10:00:00.000Z');
const storeLayer = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
  Layer.merge(Layer.succeed(ThreadEntryKinds, ENTRY_KINDS)),
  Layer.merge(BunFileSystem.layer),
);
const raise = Effect.fn('testing.restedThread')(function* (threadId: string) {
  const files = yield* FileSystem.FileSystem;
  const { db } = yield* MachineStore;
  const registered = yield* db
    .insert(project())
    .values({ name: 'p', repoKey: `/p/${threadId}`, rootPath: `/p/${threadId}`, createdAt: rested })
    .returning()
    .get();
  if (registered === undefined) return yield* Effect.die(new Error('the resting project was not registered'));
  yield* bornThread(
    db,
    {
      id: threadId,
      ownerId: 'owner',
      agentId: 'tagma',
      authority: { mode: 'trust', bypassFrom: null },
      profile: null,
      spawnRootId: threadId,
      cacheGroup: threadId,
      provider: 'openai-oauth',
      status: 'idle',
      createdAt: rested,
      updatedAt: rested,
    },
    { projectId: registered.id, title: 'the rested thread' },
  );
  yield* db.insert(threadEvent()).values({
    threadId,
    position: 1,
    id: 'e-1',
    kind: 'message',
    payload: {
      entry: { type: 'message', id: 'm-1', role: 'user', text: 'hello' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    },
  });
  yield* db.run(
    sql`insert into thread_compaction_checkpoint (id, thread_id, covered_message_count, covered_prefix_hash, summary, created_at) values (${'c-1'}, ${threadId}, 1, ${'hash'}, ${'the past, folded'}, ${rested.getTime()})`,
  );
  yield* db.run(
    sql`insert into thread_pruned_tool_call (thread_id, tool_call_id, created_at) values (${threadId}, ${'tc-1'}, ${rested.getTime()})`,
  );
  yield* db.run(sql`insert into thread_log (thread_id, history_through, entries_through) values (${threadId}, 1, 1)`);
  yield* db.run(
    sql`insert into thread_history_item (thread_id, ord, message) values (${threadId}, 0, ${JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'hello' }] })})`,
  );
  yield* db.run(
    sql`insert into thread_entry (thread_id, ord, entry_id, type, entry) values (${threadId}, 0, ${'m-1'}, ${'message'}, ${JSON.stringify({ type: 'message', id: 'm-1', role: 'user', text: 'hello' })})`,
  );
  const path = join(yield* files.makeTempDirectoryScoped({ prefix: 'evict-' }), `${threadId}.jsonl`);
  yield* exportThreadRollout({ threadId, path, parts: nativeOnlyParts });
  const projection = yield* threadProjection(ENTRY_KINDS);
  const carried = projection.run({ threadId, path });
  yield* carried;
  const projected = Effect.gen(function* () {
    return {
      events: yield* db.select().from(threadEvent()).where(eq(threadEvent().threadId, threadId)),
      checkpoints: yield* db.all(
        sql`select id, thread_id as "threadId", covered_message_count as "coveredMessageCount", covered_prefix_hash as "coveredPrefixHash", summary, created_at as "createdAt" from thread_compaction_checkpoint where thread_id = ${threadId}`,
      ),
      pruned: yield* db.all(
        sql`select thread_id as "threadId", tool_call_id as "toolCallId", tokens, created_at as "createdAt" from thread_pruned_tool_call where thread_id = ${threadId}`,
      ),
      log: yield* db.all(
        sql`select thread_id as "threadId", history_through as "historyThrough", entries_through as "entriesThrough" from thread_log where thread_id = ${threadId}`,
      ),
      messages: yield* db.all(
        sql`select thread_id as "threadId", ord, message from thread_history_item where thread_id = ${threadId} order by ord`,
      ),
      entries: yield* db.all(
        sql`select thread_id as "threadId", ord, entry_id as "entryId", run_id as "runId", type, entry from thread_entry where thread_id = ${threadId} order by ord`,
      ),
    };
  }).pipe(Effect.withSpan('testing.restedProjection'));
  return {
    db,
    files,
    path,
    projected,
    record: recordOf(db, threadId),
    rest: restOf(db, threadId),
    cursor: db.select().from(threadRolloutCursor()).where(eq(threadRolloutCursor().threadId, threadId)).get(),
    carried,
  };
});

it.live('the records leave, the file and the cursor stand, and the next boot pass carries nothing', () =>
  Effect.gen(function* () {
    const world = yield* raise('t-rested');
    const before = yield* world.projected;
    const bytes = yield* world.files.readFileString(world.path);
    expect(yield* evictThreadProjection({ threadId: 't-rested', path: world.path, parts: nativeOnlyParts })).toMatchObject({
      outcome: 'evicted',
    });
    const after = yield* world.projected;
    expect([after.events, after.checkpoints, after.pruned, after.log, after.messages, after.entries]).toEqual([[], [], [], [], [], []]);
    expect(yield* world.rest).toBeInstanceOf(Date);
    expect(yield* world.files.readFileString(world.path)).toBe(bytes);
    expect((yield* world.record)?.title).toBe('the rested thread');
    expect((yield* world.cursor)?.nextByteOffset).toBe(Number((yield* world.files.stat(world.path)).size));
    expect((yield* world.carried).projected).toBe(0);
    yield* rehydrateThreadRecords({ threadId: 't-rested', path: world.path, parts: nativeOnlyParts });
    expect(yield* world.projected).toEqual(before);
    expect(yield* world.rest).toBeNull();
  }).pipe(Effect.provide(storeLayer)),
);

it.live('a return cut between its transactions is carried to the end by the next one', () =>
  Effect.gen(function* () {
    const world = yield* raise('t-cut');
    const before = yield* world.projected;
    yield* evictThreadProjection({ threadId: 't-cut', path: world.path, parts: nativeOnlyParts });
    yield* world.db.insert(threadEvent()).values(before.events);
    yield* world.db.run(sql`insert into thread_history_item (thread_id, ord, message) values (${'t-cut'}, 0, ${'{}'})`);
    expect(yield* world.rest).toBeInstanceOf(Date);
    yield* rehydrateThreadRecords({ threadId: 't-cut', path: world.path, parts: nativeOnlyParts });
    expect(yield* world.projected).toEqual(before);
    expect(yield* world.rest).toBeNull();
  }).pipe(Effect.provide(storeLayer)),
);

it.live('a thread whose rows have not caught up with its file is kept', () =>
  Effect.gen(function* () {
    const world = yield* raise('t-behind');
    yield* world.files.writeFileString(
      world.path,
      `${JSON.stringify({ kind: 'event', row: { threadId: 't-behind', position: 2, id: 'e-2', kind: 'message', payload: { text: 'later' } } })}\n`,
      { flag: 'a' },
    );
    expect(yield* evictThreadProjection({ threadId: 't-behind', path: world.path, parts: nativeOnlyParts })).toEqual({
      outcome: 'kept',
      reason: 'cursor-behind',
    });
    expect((yield* world.projected).events).toHaveLength(1);
  }).pipe(Effect.provide(storeLayer)),
);

it.live('a rollout holding a record the carry cannot read keeps the thread whole', () =>
  Effect.gen(function* () {
    const world = yield* raise('t-uncarried');
    yield* world.files.writeFileString(world.path, `${JSON.stringify({ kind: 'fold', row: { threadId: 't-uncarried', history: [] } })}\n`, {
      flag: 'a',
    });
    yield* world.carried;
    expect(yield* evictThreadProjection({ threadId: 't-uncarried', path: world.path, parts: nativeOnlyParts })).toEqual({
      outcome: 'kept',
      reason: 'records-unreadable',
    });
    expect((yield* world.projected).events).toHaveLength(1);
  }).pipe(Effect.provide(storeLayer)),
);

it.live('a checkpoint the rows hold and the file never recorded keeps the thread', () =>
  Effect.gen(function* () {
    const world = yield* raise('t-unrecorded');
    yield* world.db.run(
      sql`insert into thread_compaction_checkpoint (id, thread_id, covered_message_count, covered_prefix_hash, summary, created_at) values (${'c-2'}, ${'t-unrecorded'}, 2, ${'later'}, ${'folded again'}, ${rested.getTime()})`,
    );
    expect(yield* evictThreadProjection({ threadId: 't-unrecorded', path: world.path, parts: nativeOnlyParts })).toEqual({
      outcome: 'kept',
      reason: 'records-missing',
    });
    expect((yield* world.projected).checkpoints).toHaveLength(2);
  }).pipe(Effect.provide(storeLayer)),
);
