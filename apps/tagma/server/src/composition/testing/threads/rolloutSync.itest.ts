import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { fixtureMigrations } from '../migrations.js';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { asc, eq } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import {
  threadStore,
  threadCompactionCheckpoint,
  threadHistoryItem,
  threadLog,
  threadPrunedToolCall,
} from '../../../native-harness/testing/doubles.js';
import { project } from '../../../projects/testing/doubles.js';
import { session } from '../../../platform/store/writers.js';

import { thread, threadEntry } from '../../../threads/testing/doubles.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { threadMandate } from '../../../threads/testing/doubles.js';
import { threadEvent, threadRolloutCursor, threadSourceIntent } from '../../../threads/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { recordOf } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { restFor, restOf } from '../../../threads/testing/rest.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { threadResource } from '../../../threads/testing/doubles.js';
import { appendRolloutItem, createRollout } from '../../../threads/testing/doubles.js';
import { appendThreadRollout, exportThreadRollout } from '../../../threads/testing/doubles.js';
import { rehydrateThreadRecords, replayThreadRollout } from '../../../threads/testing/doubles.js';
import { rolloutForms, threadRolloutMeta } from '../../../threads/testing/doubles.js';
import { ENTRY_KINDS } from '../composed.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { ThreadEventPayload } from '@runlith/agent/thread/events';
import { Message } from '@runlith/llm/schema/messages';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
  Layer.merge(Layer.succeed(ThreadEntryKinds, ENTRY_KINDS)),
  Layer.merge(BunFileSystem.layer),
);

const said = (id: string, text: string): ThreadEventPayload => ({ entry: { type: 'message', id, role: 'user', text } });

describe('the thread rollout sync', () => {
  it.live(
    'a thread with its facet, events, checkpoint, pruning and holdings survives export, wipe and replay with both folds rebuilt',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);

      const db = (yield* Effect.provide(MachineStore, runtime)).db;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* Effect.provide(
        db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
        runtime,
      );
      yield* Effect.provide(
        bornThread(
          db,
          {
            id: 't-1',
            ownerId: 'owner',
            agentId: 'tagma',
            authority: { mode: 'trust', bypassFrom: null },
            profile: null,
            spawnRootId: 't-1',
            cacheGroup: 't-1',
            provider: 'openai-oauth',
            status: 'idle',
            pendingInteraction: {
              type: 'question',
              id: 'q-1',
              runId: 'r-1',
              questionId: 'q-1',
              questions: [],
              toolCalls: [],
              status: 'open',
            },
            createdAt: born,
            updatedAt: born,
          },
          { projectId: (registered as { id: number }).id, title: 'probe' },
        ),
        runtime,
      );
      yield* Effect.provide(db.update(thread()).set({ contextEventId: 5 }).where(eq(thread().id, 't-1')), runtime);
      yield* Effect.provide(
        db.insert(threadEvent()).values({
          threadId: 't-1',
          position: 1,
          id: 'e-1',
          kind: 'message',
          payload: {
            entry: { type: 'message', id: 'm-1', role: 'user', text: 'hello' },
            messages: [Message.user('hello')],
          },
        }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadEvent()).values({
          threadId: 't-1',
          position: 2,
          id: 'e-2',
          kind: 'tool-call',
          payload: {
            entry: { type: 'tool', id: 'tc-1', runId: 'r-1', toolName: 'graph', toolCallId: 'tc-1', toolState: 'input-available' },
          },
        }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadCompactionCheckpoint()).values({
          id: 'c-1',
          threadId: 't-1',
          coveredMessageCount: 1,
          coveredPrefixHash: 'hash',
          summary: 'the past, folded',
          createdAt: born,
        }),
        runtime,
      );
      yield* Effect.provide(db.insert(threadPrunedToolCall()).values({ threadId: 't-1', toolCallId: 'tc-1', createdAt: born }), runtime);
      yield* Effect.provide(db.insert(threadResource()).values({ kind: 'scratch', id: 't-1', threadId: 't-1', heldAt: born }), runtime);
      const all = Effect.fnUntraced(function* () {
        return {
          record: yield* Effect.provide(db.select().from(threadRecord()), runtime),
          mandate: yield* Effect.provide(db.select().from(threadMandate()), runtime),
          native: yield* Effect.provide(db.select().from(thread()), runtime),
          events: yield* Effect.provide(db.select().from(threadEvent()), runtime),
          checkpoints: yield* Effect.provide(db.select().from(threadCompactionCheckpoint()), runtime),
          pruned: yield* Effect.provide(db.select().from(threadPrunedToolCall()), runtime),
          held: yield* Effect.provide(db.select().from(threadResource()), runtime),
        };
      });
      const before = yield* all();
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-sync-' }),
        't-1.jsonl',
      );
      const exported = yield* Effect.provide(exportThreadRollout({ threadId: 't-1', path, parts: yield* nativeOnlyParts }), runtime);
      expect(exported.records).toBe(5);
      yield* Effect.provide(db.delete(threadLog()), runtime);
      yield* Effect.provide(db.delete(threadResource()), runtime);
      yield* Effect.provide(db.delete(threadPrunedToolCall()), runtime);
      yield* Effect.provide(db.delete(threadCompactionCheckpoint()), runtime);
      yield* Effect.provide(db.delete(threadEvent()), runtime);
      yield* Effect.provide(db.delete(threadRecord()), runtime);
      const replayed = yield* Effect.provide(
        replayThreadRollout({ path, parts: yield* nativeOnlyParts, records: yield* Effect.provide(makeThreadRecords, runtime) }),
        runtime,
      );
      expect(replayed.threadId).toBe('t-1');
      expect(yield* all()).toEqual(before);
      const log = yield* Effect.provide(db.select().from(threadLog()).get(), runtime);
      const messages = yield* Effect.provide(db.select().from(threadHistoryItem()).orderBy(asc(threadHistoryItem().ord)), runtime);
      expect(messages.map((row) => [row.ord, row.message])).toEqual([[0, Message.user('hello')]]);
      expect(log?.historyThrough).toBe(2);
      expect(log?.entriesThrough).toBe(2);
      const entries = yield* Effect.provide(db.select().from(threadEntry()), runtime);
      expect(entries.map((row) => [row.ord, row.entryId])).toEqual([
        [0, 'm-1'],
        [1, 'tc-1'],
      ]);
      const store = yield* Effect.provide(
        Effect.flatMap(makeThreadRecords, (records) => threadStore(records, ENTRY_KINDS)),
        runtime,
      );
      expect((yield* Effect.provide(store.entriesOfRun('t-1', 'r-1'), runtime)).map((entry) => entry.id)).toEqual(['tc-1']);
    }),
  );

  it.live(
    'a retired pruning mark replays as the deletion it was',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);

      const db = (yield* Effect.provide(MachineStore, runtime)).db;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* Effect.provide(
        db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
        runtime,
      );
      yield* Effect.provide(
        bornThread(
          db,
          {
            id: 't-1',
            ownerId: 'owner',
            agentId: 'tagma',
            authority: { mode: 'trust', bypassFrom: null },
            profile: null,
            spawnRootId: 't-1',
            cacheGroup: 't-1',
            provider: 'openai-oauth',
            status: 'idle',
            createdAt: born,
            updatedAt: born,
          },
          { projectId: (registered as { id: number }).id, title: 'probe' },
        ),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadPrunedToolCall()).values([
          { threadId: 't-1', toolCallId: 'call-folded', createdAt: born },
          { threadId: 't-1', toolCallId: 'call-standing', createdAt: born },
        ]),
        runtime,
      );
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-retire-' }),
        't-1.jsonl',
      );
      yield* Effect.provide(exportThreadRollout({ threadId: 't-1', path, parts: yield* nativeOnlyParts }), runtime);
      yield* Effect.provide(
        appendRolloutItem(path, { kind: 'pruned-retired', row: { threadId: 't-1', toolCallId: 'call-folded' } }),
        runtime,
      );
      yield* Effect.provide(db.delete(threadPrunedToolCall()), runtime);
      yield* Effect.provide(db.delete(threadLog()), runtime);
      yield* Effect.provide(db.delete(threadRecord()), runtime);
      yield* Effect.provide(
        replayThreadRollout({ path, parts: yield* nativeOnlyParts, records: yield* Effect.provide(makeThreadRecords, runtime) }),
        runtime,
      );
      expect((yield* Effect.provide(db.select().from(threadPrunedToolCall()), runtime)).map((row) => row.toolCallId)).toEqual([
        'call-standing',
      ]);
    }),
  );

  it.live(
    'a grown thread appends its new events and replays identically',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);

      const db = (yield* Effect.provide(MachineStore, runtime)).db;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* Effect.provide(
        db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
        runtime,
      );
      yield* Effect.provide(
        bornThread(
          db,
          {
            id: 't-grow',
            ownerId: 'owner',
            agentId: 'tagma',
            authority: { mode: 'trust', bypassFrom: null },
            profile: null,
            spawnRootId: 't-grow',
            cacheGroup: 't-grow',
            provider: 'openai-oauth',
            status: 'idle',
            createdAt: born,
            updatedAt: born,
          },
          { projectId: (registered as { id: number }).id, title: 'growing' },
        ),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadEvent()).values({ threadId: 't-grow', position: 1, id: 'e-1', kind: 'message', payload: said('e-1', 'one') }),
        runtime,
      );
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-append-' }),
        't-grow.jsonl',
      );
      yield* Effect.provide(exportThreadRollout({ threadId: 't-grow', path, parts: yield* nativeOnlyParts }), runtime);
      const files = Context.get(runtime, FileSystem.FileSystem);
      const first = yield* files.readFileString(path);
      yield* Effect.provide(
        db.insert(threadEvent()).values({ threadId: 't-grow', position: 2, id: 'e-2', kind: 'message', payload: said('e-2', 'two') }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadEvent()).values({ threadId: 't-grow', position: 3, id: 'e-3', kind: 'message', payload: said('e-3', 'three') }),
        runtime,
      );
      const appended = yield* Effect.provide(
        appendThreadRollout({ threadId: 't-grow', path, after: 1, parts: yield* nativeOnlyParts }),
        runtime,
      );
      expect(appended.records).toBe(2);
      const grown = yield* files.readFileString(path);
      expect(grown.startsWith(first)).toBe(true);
      expect(grown.split('\n').filter(Boolean)).toHaveLength(first.split('\n').filter(Boolean).length + 2);
      const events = yield* Effect.provide(db.select().from(threadEvent()), runtime);
      yield* Effect.provide(db.delete(threadLog()), runtime);
      yield* Effect.provide(db.delete(threadEvent()), runtime);
      yield* Effect.provide(db.delete(threadRecord()), runtime);
      yield* Effect.provide(
        replayThreadRollout({ path, parts: yield* nativeOnlyParts, records: yield* Effect.provide(makeThreadRecords, runtime) }),
        runtime,
      );
      expect(yield* Effect.provide(db.select().from(threadEvent()), runtime)).toEqual(events);
    }),
  );

  it.live(
    'republishing recovers an interrupted replacement before advancing its cursor',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);

      const db = (yield* Effect.provide(MachineStore, runtime)).db;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* Effect.provide(
        db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
        runtime,
      );
      yield* Effect.provide(
        bornThread(
          db,
          {
            id: 't-cursor',
            ownerId: 'owner',
            agentId: 'tagma',
            authority: { mode: 'trust', bypassFrom: null },
            profile: null,
            spawnRootId: 't-cursor',
            cacheGroup: 't-cursor',
            provider: 'openai-oauth',
            status: 'idle',
            createdAt: born,
            updatedAt: born,
          },
          { projectId: (registered as { id: number }).id, title: 'cursed' },
        ),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadEvent()).values({ threadId: 't-cursor', position: 1, id: 'e-1', kind: 'message', payload: said('e-1', 'one') }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadRolloutCursor()).values({ threadId: 't-cursor', nextByteOffset: 4096, nextPosition: 2 }),
        runtime,
      );
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-cursor-' }),
        't-cursor.jsonl',
      );
      yield* Effect.provide(exportThreadRollout({ threadId: 't-cursor', path, parts: yield* nativeOnlyParts }), runtime);
      expect(
        yield* Effect.provide(db.select().from(threadRolloutCursor()).where(eq(threadRolloutCursor().threadId, 't-cursor')), runtime),
      ).toEqual([{ threadId: 't-cursor', nextByteOffset: 0, nextPosition: 1, generation: 1, restedAt: null }]);
      const files = Context.get(runtime, FileSystem.FileSystem);
      const prior = yield* files.readFileString(path);
      const operation = randomUUID();
      const backup = `${path}.source-backup-${operation}`;
      const staged = `${path}.partial`;
      const next = prior.replace('"text":"one"', '"text":"uncommitted"');
      expect(next).not.toBe(prior);
      yield* files.writeFileString(staged, next);
      yield* Effect.provide(
        db.insert(threadSourceIntent()).values({
          threadId: 't-cursor',
          operation,
          place: 't-cursor.jsonl',
          stage: '.partial',
          digest: createHash('sha256').update(next).digest('hex'),
          previous: 'plain',
          previousDigest: createHash('sha256').update(prior).digest('hex'),
          target: 'plain',
        }),
        runtime,
      );
      yield* files.rename(path, backup);
      yield* files.rename(staged, path);
      yield* Effect.provide(exportThreadRollout({ threadId: 't-cursor', path, parts: yield* nativeOnlyParts }), runtime);
      expect(yield* files.readFileString(path)).toBe(prior);
      expect(yield* files.exists(backup)).toBe(false);
      expect(
        yield* Effect.provide(db.select().from(threadSourceIntent()).where(eq(threadSourceIntent().threadId, 't-cursor')), runtime),
      ).toEqual([]);
      expect(
        yield* Effect.provide(db.select().from(threadRolloutCursor()).where(eq(threadRolloutCursor().threadId, 't-cursor')), runtime),
      ).toEqual([{ threadId: 't-cursor', nextByteOffset: 0, nextPosition: 1, generation: 2, restedAt: null }]);
    }),
  );

  it.live(
    'the session that opened a thread is resolved by identity, not by its number',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);

      const db = (yield* Effect.provide(MachineStore, runtime)).db;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* Effect.provide(
        db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
        runtime,
      );
      for (const key of ['one', 'two', 'three']) {
        yield* Effect.provide(db.insert(session).values({ harness: 'claude-code', key, createdAt: born }), runtime);
      }
      const opener = yield* Effect.provide(
        db.insert(session).values({ harness: 'claude-code', key: 'opener', createdAt: born }).returning().get(),
        runtime,
      );
      yield* Effect.provide(
        bornThread(
          db,
          {
            id: 't-2',
            ownerId: 'owner',
            agentId: 'tagma',
            authority: { mode: 'trust', bypassFrom: null },
            profile: null,
            spawnRootId: 't-2',
            cacheGroup: 't-2',
            provider: 'openai-oauth',
            status: 'idle',
            createdAt: born,
            updatedAt: born,
          },
          {
            projectId: (registered as { id: number }).id,
            title: 'opened by a session',
            createdBySessionId: (opener as { id: number }).id,
          },
        ),
        runtime,
      );
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-opener-' }),
        't-2.jsonl',
      );
      yield* Effect.provide(exportThreadRollout({ threadId: 't-2', path, parts: yield* nativeOnlyParts }), runtime);
      yield* Effect.provide(db.delete(threadRecord()), runtime);
      yield* Effect.provide(db.delete(session), runtime);
      yield* Effect.provide(
        replayThreadRollout({ path, parts: yield* nativeOnlyParts, records: yield* Effect.provide(makeThreadRecords, runtime) }),
        runtime,
      );
      const facet = yield* Effect.provide(recordOf(db, 't-2'), runtime);
      const revivedSession = yield* Effect.provide(db.select().from(session).get(), runtime);
      expect(revivedSession?.key).toBe('opener');
      expect(revivedSession?.harness).toBe('claude-code');
      expect(facet?.createdBySessionId).toBe(revivedSession?.id as number);
    }),
  );

  it.live(
    'an evicted thread takes its records back, keeps what it holds, and stands at the end of its file',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);

      const db = (yield* Effect.provide(MachineStore, runtime)).db;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* Effect.provide(
        db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
        runtime,
      );
      yield* Effect.provide(
        bornThread(
          db,
          {
            id: 't-evicted',
            ownerId: 'owner',
            agentId: 'tagma',
            authority: { mode: 'trust', bypassFrom: null },
            profile: null,
            spawnRootId: 't-evicted',
            cacheGroup: 't-evicted',
            provider: 'openai-oauth',
            status: 'idle',
            createdAt: born,
            updatedAt: born,
          },
          { projectId: (registered as { id: number }).id, title: 'the rested thread' },
        ),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadEvent()).values({
          threadId: 't-evicted',
          position: 1,
          id: 'e-1',
          kind: 'message',
          payload: {
            entry: { type: 'message', id: 'm-1', role: 'user', text: 'hello' },
            messages: [Message.user('hello')],
          },
        }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadEvent()).values({
          threadId: 't-evicted',
          position: 2,
          id: 'e-2',
          kind: 'tool-call',
          payload: {
            entry: { type: 'tool', id: 'tc-1', runId: 'r-1', toolName: 'graph', toolCallId: 'tc-1', toolState: 'input-available' },
          },
        }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadCompactionCheckpoint()).values({
          id: 'c-1',
          threadId: 't-evicted',
          coveredMessageCount: 1,
          coveredPrefixHash: 'hash',
          summary: 'the past, folded',
          createdAt: born,
        }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadPrunedToolCall()).values({ threadId: 't-evicted', toolCallId: 'tc-1', createdAt: born }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadResource()).values({ kind: 'scratch', id: 't-evicted', threadId: 't-evicted', heldAt: born }),
        runtime,
      );
      yield* Effect.provide(db.insert(threadLog()).values({ threadId: 't-evicted', historyThrough: 2, entriesThrough: 2 }), runtime);
      yield* Effect.provide(
        db.insert(threadHistoryItem()).values({ threadId: 't-evicted', ord: 0, message: Message.user('hello') }),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadEntry()).values([
          {
            threadId: 't-evicted',
            ord: 0,
            entryId: 'm-1',
            runId: null,
            type: 'message',
            entry: { type: 'message', id: 'm-1', role: 'user', text: 'hello' },
          },
          {
            threadId: 't-evicted',
            ord: 1,
            entryId: 'tc-1',
            runId: 'r-1',
            type: 'tool',
            entry: { type: 'tool', id: 'tc-1', runId: 'r-1', toolName: 'graph', toolCallId: 'tc-1', toolState: 'input-available' },
          },
        ]),
        runtime,
      );
      const projection = Effect.fnUntraced(function* () {
        return {
          events: yield* Effect.provide(db.select().from(threadEvent()), runtime),
          checkpoints: yield* Effect.provide(db.select().from(threadCompactionCheckpoint()), runtime),
          pruned: yield* Effect.provide(db.select().from(threadPrunedToolCall()), runtime),
          log: yield* Effect.provide(db.select().from(threadLog()), runtime),
          messages: yield* Effect.provide(db.select().from(threadHistoryItem()).orderBy(asc(threadHistoryItem().ord)), runtime),
          entries: yield* Effect.provide(db.select().from(threadEntry()).orderBy(asc(threadEntry().ord)), runtime),
        };
      });
      const before = yield* projection();
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-evict-' }),
        't-evicted.jsonl',
      );
      yield* Effect.provide(exportThreadRollout({ threadId: 't-evicted', path, parts: yield* nativeOnlyParts }), runtime);
      yield* Effect.provide(db.delete(threadEntry()), runtime);
      yield* Effect.provide(db.delete(threadHistoryItem()), runtime);
      yield* Effect.provide(db.delete(threadLog()), runtime);
      yield* Effect.provide(db.delete(threadPrunedToolCall()), runtime);
      yield* Effect.provide(db.delete(threadCompactionCheckpoint()), runtime);
      yield* Effect.provide(db.delete(threadEvent()), runtime);
      yield* Effect.provide(restFor(db, 't-evicted', born), runtime);
      yield* Effect.provide(rehydrateThreadRecords({ threadId: 't-evicted', path, parts: yield* nativeOnlyParts }), runtime);
      expect(yield* projection()).toEqual(before);
      expect((yield* Effect.provide(db.select().from(threadResource()), runtime)).map((row) => [row.kind, row.id])).toEqual([
        ['scratch', 't-evicted'],
      ]);
      const facet = yield* Effect.provide(recordOf(db, 't-evicted'), runtime);
      expect(yield* Effect.provide(restOf(db, 't-evicted'), runtime)).toBeNull();
      expect(facet?.title).toBe('the rested thread');
      const cursor = yield* Effect.provide(
        db.select().from(threadRolloutCursor()).where(eq(threadRolloutCursor().threadId, 't-evicted')).get(),
        runtime,
      );
      expect(cursor?.nextByteOffset).toBe((yield* Context.get(runtime, FileSystem.FileSystem).readFile(path)).length);
      expect(cursor?.nextPosition).toBe(3);
    }),
  );

  it.live(
    'a replayed thread stands with its projection, whatever stamp its meta line carried',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);

      const db = (yield* Effect.provide(MachineStore, runtime)).db;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* Effect.provide(
        db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
        runtime,
      );
      yield* Effect.provide(
        bornThread(
          db,
          {
            id: 't-stamped',
            ownerId: 'owner',
            agentId: 'tagma',
            authority: { mode: 'trust', bypassFrom: null },
            profile: null,
            spawnRootId: 't-stamped',
            cacheGroup: 't-stamped',
            provider: 'openai-oauth',
            status: 'idle',
            createdAt: born,
            updatedAt: born,
          },
          { projectId: (registered as { id: number }).id, title: 'evicted and then lost' },
        ),
        runtime,
      );
      yield* Effect.provide(
        db.insert(threadEvent()).values({ threadId: 't-stamped', position: 1, id: 'e-1', kind: 'message', payload: said('e-1', 'one') }),
        runtime,
      );
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-stamped-' }),
        't-stamped.jsonl',
      );
      yield* Effect.provide(exportThreadRollout({ threadId: 't-stamped', path, parts: yield* nativeOnlyParts }), runtime);
      yield* Effect.provide(restFor(db, 't-stamped', born), runtime);
      yield* Effect.provide(
        appendRolloutItem(path, {
          kind: 'meta',
          meta: yield* Effect.provide(threadRolloutMeta('t-stamped', yield* nativeOnlyParts), runtime),
        }),
        runtime,
      );
      yield* Effect.provide(db.delete(threadLog()), runtime);
      yield* Effect.provide(db.delete(threadEvent()), runtime);
      yield* Effect.provide(db.delete(threadRecord()), runtime);
      yield* Effect.provide(
        replayThreadRollout({ path, parts: yield* nativeOnlyParts, records: yield* Effect.provide(makeThreadRecords, runtime) }),
        runtime,
      );
      expect(yield* Effect.provide(restOf(db, 't-stamped'), runtime)).toBeNull();
      expect((yield* Effect.provide(db.select().from(threadEvent()), runtime)).map((row) => row.id)).toEqual(['e-1']);
    }),
  );

  it.live(
    'a thread the database does not hold refuses by name',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-sync-' }),
        'ghost.jsonl',
      );
      const error = yield* Effect.provide(
        Effect.flip(exportThreadRollout({ threadId: 'ghost', path, parts: yield* nativeOnlyParts })),
        runtime,
      );
      expect(error._tag === 'RolloutSyncRefused' && error.reason).toBe('thread-missing');
    }),
  );

  it.live(
    'an old native rollout replays its record, mandate and native row',
    Effect.fnUntraced(function* () {
      const runtime = yield* Layer.build(storage);

      const db = (yield* Effect.provide(MachineStore, runtime)).db;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* Effect.provide(
        db.insert(project()).values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born }).returning().get(),
        runtime,
      );
      const at = born.toISOString();
      const oldThread = {
        id: 't-old',
        ownerId: 'owner',
        agentId: 'tagma',
        parentThreadId: null,
        spawnRootId: 't-old',
        name: null,
        authority: { mode: 'trust', bypassFrom: null },
        budgetTokens: null,
        hostKind: null,
        hostId: null,
        cacheGroup: 't-old',
        provider: 'openai-oauth',
        model: null,
        reasoning: null,
        status: 'idle',
        failureReason: null,
        createdAt: at,
        updatedAt: at,
      };
      const oldFacet = {
        projectId: (registered as { id: number }).id,
        title: 'old harbor',
        titleOrigin: 'random',
        titleRevision: 0,
        titleAskedInput: null,
        scopeBlockUuid: null,
        readerOrderAt: at,
        pinnedAt: null,
        archivedAt: null,
        delegation: true,
        contextEventId: 7,
        worldStateSnapshot: {},
        worldStateCheckpointId: null,
        harness: null,
      };
      const path = join(
        yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'rollout-old-' }),
        't-old.jsonl',
      );
      yield* Effect.provide(createRollout(path, { thread: oldThread, facet: oldFacet, session: null }), runtime);
      yield* Effect.provide(
        appendRolloutItem(path, {
          kind: 'event',
          row: { threadId: 't-old', position: 1, id: 'e-1', kind: 'message', payload: said('e-1', 'hello') },
        }),
        runtime,
      );
      yield* Effect.provide(
        Effect.flatMap(
          rolloutForms((_id, work) => work, ENTRY_KINDS),
          (forms) => forms.formedHere('t-old', path),
        ),
        runtime,
      );
      const replayed = yield* Effect.provide(
        replayThreadRollout({ path, parts: yield* nativeOnlyParts, records: yield* Effect.provide(makeThreadRecords, runtime) }),
        runtime,
      );
      expect(replayed.threadId).toBe('t-old');
      const record = yield* Effect.provide(recordOf(db, 't-old'), runtime);
      expect(record?.projectId).toBe((registered as { id: number }).id);
      expect(record?.title).toBe('old harbor');
      expect(record?.principalId).toBe('owner');
      const mandate = yield* Effect.provide(db.select().from(threadMandate()).where(eq(threadMandate().id, 't-old')).get(), runtime);
      expect(mandate?.authority).toEqual({ mode: 'trust', bypassFrom: null });
      expect(mandate?.delegation).toBe(true);
      const native = yield* Effect.provide(db.select().from(thread()).where(eq(thread().id, 't-old')).get(), runtime);
      expect(native?.provider).toBe('openai-oauth');
      expect(native?.contextEventId).toBe(7);
      expect((yield* Effect.provide(db.select().from(threadEvent()), runtime)).map((row) => row.id)).toEqual(['e-1']);
    }),
  );
});
