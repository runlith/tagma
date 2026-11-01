import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { DateTime, Effect, FileSystem } from 'effect';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Message } from '@runlith/llm/schema/messages';
import { WIRE_PAGE_MAX_BYTES } from '@runlith/agent/protocol/cap';
import { readThreadEvents } from '@runlith/agent/thread/events';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import {
  foldedToolFact,
  threadEntry,
  threadEvent,
  evictThreadProjection,
  threadProjection,
  exportThreadRollout,
  rehydrateThreadRecords,
} from '../../../threads/testing/doubles.js';
import { threadEventStripping, threadLog, typeOf } from '../../../native-harness/testing/doubles.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import { project } from '../../../projects/testing/doubles.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { fixtureHome } from '../../../platform/testing/roots.js';
import { ENTRY_KINDS } from '../composed.js';
import { makeThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { StorageFixture, freshStorage, storageFixture } from './storage.fixture.js';

type Stand = StorageFixture['Service'];

const CALL: ThreadToolEntry = {
  type: 'tool',
  id: 'tool:c1',
  runId: 'run-1',
  toolName: 'read',
  toolCallId: 'c1',
  toolState: 'input-available',
  toolInput: { filePath: '/a' },
  occurredAt: '2026-09-10T10:00:00.000Z',
};

const SETTLED: ThreadToolEntry = {
  ...CALL,
  toolState: 'output-available',
  toolOutput: { text: 'x'.repeat(2_000) },
  toolDisplay: { form: 'text', title: '/a', text: 'the file' },
};

const append = (it: Stand, threadId: string, id: string, kind: string, payload: unknown) =>
  it.threads.transaction((tx) => it.events.append({ threadId, id, kind, payload: payload as never }, tx));

const projected = (it: Stand, threadId: string) => it.fold(threadId, (row) => Effect.succeed({ history: [...row.history] }));

const factAt = (it: Stand, threadId: string, position: number) =>
  it.db
    .select({ payload: threadEvent().payload })
    .from(threadEvent())
    .where(and(eq(threadEvent().threadId, threadId), eq(threadEvent().position, position)))
    .get();

const entriesOf = (it: Stand, threadId: string) =>
  it.db
    .select({ entry: threadEntry().entry })
    .from(threadEntry())
    .where(eq(threadEntry().threadId, threadId))
    .orderBy(asc(threadEntry().ord));

const born = (it: Stand) => it.threads.insert({ ownerId: 'owner', agentId: 'agent' });

layer(storageFixture, { excludeTestServices: true })('folded tool facts', (it) => {
  it.effect('a settled call keeps one body, and every reader is answered whole', () =>
    Effect.gen(function* () {
      const stand = yield* freshStorage;
      const thread = yield* born(stand);
      yield* append(stand, thread.id, 'e-1', 'tool', { entry: CALL });
      yield* projected(stand, thread.id);
      yield* append(stand, thread.id, 'e-2', 'tool', { entry: SETTLED });
      yield* projected(stand, thread.id);

      const folded = (yield* factAt(stand, thread.id, 2))?.payload as { entry: Record<string, unknown> };
      expect(folded.entry).toEqual({
        type: 'tool',
        id: 'tool:c1',
        runId: 'run-1',
        toolName: 'read',
        toolCallId: 'c1',
        toolState: 'output-available',
        occurredAt: CALL.occurredAt,
      });

      const earlier = (yield* factAt(stand, thread.id, 1))?.payload as { entry: ThreadToolEntry };
      expect(earlier.entry).toEqual(CALL);

      const replayed = yield* readThreadEvents(stand.events, ENTRY_KINDS, thread.id, 0, 10);
      expect(replayed.map((record) => record.payload.entry)).toEqual([CALL, SETTLED]);

      expect(yield* stand.threads.entryById(thread.id, 'tool:c1')).toEqual(SETTLED);
      expect(yield* stand.threads.entriesOfRun(thread.id, 'run-1')).toEqual([SETTLED]);
      const page = yield* stand.threads.transcriptWindow(thread.id, { limit: 10, bytes: WIRE_PAGE_MAX_BYTES });
      expect(page?.entries).toEqual([SETTLED]);
    }),
  );

  it.effect('a revision landing after the page statement cannot change what the page answered', () =>
    Effect.gen(function* () {
      const stand = yield* freshStorage;
      const thread = yield* born(stand);
      yield* append(stand, thread.id, 'e-1', 'tool', { entry: CALL });
      yield* projected(stand, thread.id);

      const settle = Effect.andThen(append(stand, thread.id, 'e-2', 'tool', { entry: SETTLED }), projected(stand, thread.id));
      let landed = false;
      const writer = yield* stand.units.read((unit) =>
        Effect.succeed({
          ...unit,
          run: <A>(query: Effect.Effect<A, StoreFailure>) =>
            Effect.tap(unit.run(query), () => {
              if (landed) return Effect.void;
              landed = true;
              return Effect.orDie(settle);
            }),
        }),
      );

      const page = yield* stand.events.recordsAsOf(thread.id, { head: 1, afterPosition: 0, limit: 10 }, writer);
      expect(yield* stand.threads.entryById(thread.id, SETTLED.id)).toEqual(SETTLED);
      expect(page.map((record) => (record.payload as { entry: ThreadToolEntry }).entry)).toEqual([CALL]);
    }),
  );

  it.effect('a withdrawal gives the body back before the row leaves', () =>
    Effect.gen(function* () {
      const stand = yield* freshStorage;
      const thread = yield* born(stand);
      yield* append(stand, thread.id, 'e-1', 'tool', { entry: SETTLED });
      yield* projected(stand, thread.id);
      expect(((yield* factAt(stand, thread.id, 1))?.payload as { entry: ThreadToolEntry }).entry.toolOutput).toBeUndefined();

      yield* append(stand, thread.id, 'e-2', 'withdrawal', { withdrawn: { runId: 'run-1', keepMessages: 0 } });
      yield* projected(stand, thread.id);

      expect(yield* entriesOf(stand, thread.id)).toEqual([]);
      expect(((yield* factAt(stand, thread.id, 1))?.payload as { entry: ThreadToolEntry }).entry).toEqual(SETTLED);
      const replayed = yield* readThreadEvents(stand.events, ENTRY_KINDS, thread.id, 0, 10);
      expect(replayed[0]?.payload.entry).toEqual(SETTLED);
    }),
  );

  it.effect('the give-back refuses a folded fact that names another entry', () =>
    Effect.gen(function* () {
      const stand = yield* freshStorage;
      const thread = yield* born(stand);
      const other = { ...SETTLED, id: 'tool:other' };
      yield* stand.db.insert(threadEvent()).values({
        threadId: thread.id,
        position: 1,
        id: 'e-1',
        kind: 'tool',
        payload: foldedToolFact({ entry: other }, other),
      });
      yield* stand.db.insert(threadEntry()).values({
        threadId: thread.id,
        ord: 0,
        entryId: SETTLED.id,
        runId: SETTLED.runId ?? null,
        type: typeOf(SETTLED),
        entry: SETTLED,
      });
      yield* stand.db.update(threadLog()).set({ entriesThrough: 1 }).where(eq(threadLog().threadId, thread.id));
      yield* append(stand, thread.id, 'e-2', 'withdrawal', { withdrawn: { runId: 'run-1', keepMessages: 0 } });

      expect(yield* Effect.flip(projected(stand, thread.id))).toMatchObject({ _tag: 'ThreadStorageFailed', call: 'entryFold.restore' });
      expect(yield* entriesOf(stand, thread.id)).toEqual([{ entry: SETTLED }]);
    }),
  );

  it.effect('an evicted thread comes back with the same entries and the same answers', () =>
    Effect.gen(function* () {
      const stand = yield* freshStorage;
      const now = DateTime.toDateUtc(yield* DateTime.now);
      const registered = yield* stand.db
        .insert(project())
        .values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: now })
        .returning()
        .get();
      const thread = yield* born(stand);
      yield* scopeRecord(stand.db, thread.id, { projectId: registered.id, title: 'folded', archivedAt: now });
      yield* append(stand, thread.id, 'e-1', 'tool', { entry: CALL });
      yield* projected(stand, thread.id);
      yield* append(stand, thread.id, 'e-2', 'tool', { entry: SETTLED });
      yield* projected(stand, thread.id);
      const before = yield* entriesOf(stand, thread.id);
      const answered = yield* readThreadEvents(stand.events, ENTRY_KINDS, thread.id, 0, 10);

      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'folded-facts-' });
      const path = join(directory, `${thread.id}.jsonl`);
      yield* exportThreadRollout({ threadId: thread.id, path, parts: yield* nativeOnlyParts });
      const projection = yield* threadProjection(ENTRY_KINDS);
      yield* projection.run({ threadId: thread.id, path });
      expect(yield* evictThreadProjection({ threadId: thread.id, path, parts: yield* nativeOnlyParts })).toMatchObject({
        outcome: 'evicted',
      });
      yield* rehydrateThreadRecords({ threadId: thread.id, path, parts: yield* nativeOnlyParts });

      expect(yield* entriesOf(stand, thread.id)).toEqual(before);
      expect(yield* readThreadEvents(stand.events, ENTRY_KINDS, thread.id, 0, 10)).toEqual(answered);
    }),
  );

  it.effect('a rollout export refuses when a folded fact has no joined body', () =>
    Effect.gen(function* () {
      const stand = yield* freshStorage;
      const now = DateTime.toDateUtc(yield* DateTime.now);
      const registered = yield* stand.db
        .insert(project())
        .values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: now })
        .returning()
        .get();
      const thread = yield* born(stand);
      yield* scopeRecord(stand.db, thread.id, { projectId: registered.id, title: 'folded', archivedAt: now });
      yield* append(stand, thread.id, 'e-1', 'tool', { entry: SETTLED });
      yield* projected(stand, thread.id);
      yield* stand.db.delete(threadEntry()).where(eq(threadEntry().threadId, thread.id));

      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'folded-hole-' });
      const path = join(directory, `${thread.id}.jsonl`);
      expect(yield* Effect.flip(exportThreadRollout({ threadId: thread.id, path, parts: yield* nativeOnlyParts }))).toMatchObject({
        _tag: 'RolloutSyncRefused',
        reason: 'record-shape',
      });
    }),
  );

  it.effect('the standing pass forms an unmarked resident tool fact before folding it and leaves a step event alone', () =>
    Effect.gen(function* () {
      const kinds = makeThreadEntryReader({
        products: [],
        steps: [
          {
            name: '20261010210000_tool_name',
            samples: { entry: { type: 'tool', toolName: 'read' } },
            entry: (entry) => (entry.type === 'tool' && entry.toolName === 'read' ? { ...entry, toolName: 'read_current' } : null),
          },
        ],
      });
      const stand = yield* freshStorage;
      const thread = yield* born(stand);
      const step = { messages: [Message.assistant('thinking')] };
      yield* stand.db.insert(threadEvent()).values([
        { threadId: thread.id, position: 1, id: 'e-1', kind: 'tool', payload: { entry: SETTLED } as never },
        { threadId: thread.id, position: 2, id: 'e-2', kind: 'step', payload: step as never },
      ]);
      yield* stand.db.insert(threadEntry()).values({
        threadId: thread.id,
        ord: 0,
        entryId: SETTLED.id,
        runId: SETTLED.runId ?? null,
        type: typeOf(SETTLED),
        entry: SETTLED as ThreadTranscriptEntry,
      });
      yield* stand.db.update(threadLog()).set({ entriesThrough: 2 }).where(eq(threadLog().threadId, thread.id));

      const stripping = yield* threadEventStripping(kinds);
      const first = yield* stripping.pass();
      expect(first).toMatchObject({
        calls: 1,
        events: 1,
        unidentified: 0,
        superseded: 0,
        alreadyFolded: 0,
        revisionChanged: 0,
        refused: 0,
      });
      expect(first.bytesRemoved).toBeGreaterThan(2_000);

      expect(((yield* factAt(stand, thread.id, 1))?.payload as { entry: ThreadToolEntry }).entry.toolOutput).toBeUndefined();
      expect((yield* factAt(stand, thread.id, 2))?.payload).toEqual(step as never);
      expect(((yield* factAt(stand, thread.id, 1))?.payload as { entry: ThreadToolEntry }).entry.toolName).toBe('read_current');
      const replayed = yield* readThreadEvents(stand.events, kinds, thread.id, 0, 10);
      expect(replayed.map((record) => record.payload.entry)).toEqual([{ ...SETTLED, toolName: 'read_current' }, undefined]);

      expect(yield* stripping.pass()).toMatchObject({ calls: 0, events: 0, alreadyFolded: 0 });
    }),
  );

  it.effect('the standing pass visits only threads with undecided facts and leaves a fact its row moved past', () =>
    Effect.gen(function* () {
      const stand = yield* freshStorage;
      const missing = yield* born(stand);
      const changed = yield* born(stand);
      yield* stand.db.insert(threadEntry()).values([
        { threadId: missing.id, ord: 0, entryId: SETTLED.id, runId: SETTLED.runId ?? null, type: typeOf(SETTLED), entry: SETTLED },
        { threadId: changed.id, ord: 0, entryId: SETTLED.id, runId: SETTLED.runId ?? null, type: typeOf(SETTLED), entry: SETTLED },
      ]);
      yield* stand.db
        .insert(threadEvent())
        .values({ threadId: changed.id, position: 1, id: 'e-earlier', kind: 'tool', payload: { entry: CALL } as never });
      yield* stand.db.update(threadLog()).set({ entriesThrough: 1 }).where(eq(threadLog().threadId, changed.id));

      const stripping = yield* threadEventStripping(ENTRY_KINDS);
      expect(yield* stripping.pass()).toMatchObject({ calls: 1, events: 0, superseded: 0, revisionChanged: 1, refused: 0 });
      expect(((yield* factAt(stand, changed.id, 1))?.payload as { entry: ThreadToolEntry }).entry).toEqual(CALL);
    }),
  );

  it.effect('the standing pass continues after one fact refuses its write', () =>
    Effect.gen(function* () {
      const stand = yield* freshStorage;
      const thread = yield* born(stand);
      const other = { ...SETTLED, id: 'tool:c2', toolCallId: 'c2' };
      yield* stand.db.insert(threadEvent()).values([
        { threadId: thread.id, position: 1, id: 'e-bad', kind: 'tool', payload: { entry: SETTLED } as never },
        { threadId: thread.id, position: 2, id: 'e-good', kind: 'tool', payload: { entry: other } as never },
      ]);
      yield* stand.db.insert(threadEntry()).values([
        { threadId: thread.id, ord: 0, entryId: SETTLED.id, runId: SETTLED.runId ?? null, type: typeOf(SETTLED), entry: SETTLED },
        { threadId: thread.id, ord: 1, entryId: other.id, runId: other.runId ?? null, type: typeOf(other), entry: other },
      ]);
      yield* stand.db.update(threadLog()).set({ entriesThrough: 2 }).where(eq(threadLog().threadId, thread.id));
      yield* stand.db.run(
        sql.raw(
          "create trigger refuse_one before update of payload on thread_event when old.id = 'e-bad' begin select raise(abort, 'one fact refused'); end",
        ),
      );

      const stripping = yield* threadEventStripping(ENTRY_KINDS);
      expect(yield* stripping.pass()).toMatchObject({ calls: 2, events: 1, refused: 1 });
      expect(((yield* factAt(stand, thread.id, 1))?.payload as { entry: ThreadToolEntry }).entry).toEqual(SETTLED);
      expect(((yield* factAt(stand, thread.id, 2))?.payload as { entry: ThreadToolEntry }).entry.toolOutput).toBeUndefined();
    }),
  );
});
