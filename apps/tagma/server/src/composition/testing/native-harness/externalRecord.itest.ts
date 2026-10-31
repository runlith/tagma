import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { DateTime, Effect, Layer } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { eq, sql } from 'drizzle-orm';
import { threadLog, threadRunStore } from '../../../native-harness/testing/doubles.js';
import { thread, threadEntry, EXTERNAL_CAPABILITIES, unmeasuredObservation } from '../../../threads/testing/doubles.js';
import { project } from '../../../projects/testing/doubles.js';
import { threadStack } from '../threadParts.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { recordOf } from '../../../thread-record/testing/records.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { ENTRY_KINDS } from '../composed.js';
import { StorageFixture, storageFixture } from './storage.fixture.js';

const PROJECT = 1;
const CREATED = new Date('2026-01-01T00:00:00.000Z');
const MOVED = new Date('2026-02-01T00:00:00.000Z');
const PARENT = new Date('2026-03-01T00:00:00.000Z');
const FIRST = new Date('2026-03-02T00:00:00.000Z');
const SECOND = new Date('2026-03-03T00:00:00.000Z');

const externalRecords = Layer.effectDiscard(
  Effect.gen(function* () {
    const { db } = yield* StorageFixture;
    yield* db.insert(project()).values({
      id: PROJECT,
      name: 'external-record',
      repoKey: '/external-record',
      rootPath: '/external-record',
      createdAt: DateTime.toDateUtc(yield* DateTime.now),
    });
  }),
).pipe(Layer.provideMerge(storageFixture));

const externalThread = Effect.fnUntraced(function* (id: string, createdAt?: Date) {
  const { db, units, records } = yield* StorageFixture;
  const { store: kernel, threads: parts } = yield* threadStack({ db, units, records, kinds: ENTRY_KINDS });
  yield* kernel.transaction((tx) =>
    Effect.gen(function* () {
      yield* kernel.insert({ id, ownerId: 'operator', agentId: 'harness', provider: 'external' }, tx);
      yield* parts.rows.attachFacet(
        {
          threadId: id,
          projectId: PROJECT,
          harness: {
            facet: {
              name: 'codex',
              presentation: harnessPresentation(builtinHarness('codex')),
              sessionKey: id,
              execution: null,
              observation: unmeasuredObservation(),
            },
            kernel: {
              transport: { adapter: 'terminal', profile: 'codex', agent: null },
              capabilities: EXTERNAL_CAPABILITIES(),
              selection: { provider: 'external', model: null, reasoning: null },
              account: null,
              switches: {},
            },
          },
        },
        tx,
      );
    }),
  );
  if (createdAt !== undefined) {
    yield* db.update(threadRecord()).set({ createdAt }).where(eq(threadRecord().id, id));
    yield* db.update(thread()).set({ updatedAt: createdAt }).where(eq(thread().id, id));
  }
});

const record = Effect.fnUntraced(function* (id: string) {
  const { db } = yield* StorageFixture;
  return yield* recordOf(db, id);
});

const mandateOf = Effect.fnUntraced(function* (id: string) {
  const { db } = yield* StorageFixture;
  return yield* db.all<{ id: string }>(sql`select id from thread_mandate where id = ${id}`);
});

const nativeOf = Effect.fnUntraced(function* (id: string) {
  const { db } = yield* StorageFixture;
  return yield* db.select({ id: thread().id }).from(thread()).where(eq(thread().id, id));
});

const logOf = Effect.fnUntraced(function* (id: string) {
  const { db } = yield* StorageFixture;
  return yield* db.select({ threadId: threadLog().threadId }).from(threadLog()).where(eq(threadLog().threadId, id));
});

const sessionOf = Effect.fnUntraced(function* (id: string) {
  const { db } = yield* StorageFixture;
  return yield* db.all<{ id: string }>(sql`select id from external_session where id = ${id}`);
});

layer(externalRecords)('external thread records', (it) => {
  it.effect('a seated external record reads its provider and the shared kernel clock', () =>
    Effect.gen(function* () {
      const { db, threads } = yield* StorageFixture;
      const id = 'ext-road-find';
      yield* externalThread(id, CREATED);
      yield* db.update(thread()).set({ updatedAt: MOVED }).where(eq(thread().id, id));

      const found = yield* threads.find(id);
      expect(found?.provider).toBe('external');
      expect(found?.cacheGroup).toBe(id);
      expect(found?.switches).toEqual({});
      expect(found?.history).toEqual([]);
      expect(found?.updatedAt.getTime()).toBe(MOVED.getTime());

      const owned = yield* threads.findOwned(id, 'operator');
      expect(owned?.provider).toBe('external');
      expect(owned?.cacheGroup).toBe(id);
      expect(owned?.history).toEqual([]);

      const meta = yield* threads.metadata(id);
      expect(meta?.provider).toBe('external');
      expect(meta?.cacheGroup).toBe(id);
      expect(meta?.switches).toEqual({});
      expect(meta?.updatedAt.getTime()).toBe(MOVED.getTime());

      const bare = 'ext-road-find-bare';
      yield* externalThread(bare, CREATED);
      const bareFound = yield* threads.find(bare);
      expect(bareFound?.updatedAt.getTime()).toBe(CREATED.getTime());
    }),
  );

  it.effect('a native parent lists its external child beside its native child in birth order', () =>
    Effect.gen(function* () {
      const { db, threads } = yield* StorageFixture;
      const parent = 'ext-road-parent';
      const first = 'ext-road-child-first';
      const second = 'ext-road-child-second';
      yield* bornThread(db, {
        id: parent,
        ownerId: 'operator',
        agentId: 'tagma',
        spawnRootId: parent,
        authority: THREAD_AUTHORITY_DEFAULT,
        createdAt: PARENT,
      });
      yield* bornThread(db, {
        id: first,
        ownerId: 'operator',
        agentId: 'harness',
        provider: 'external',
        spawnRootId: parent,
        parentThreadId: parent,
        authority: THREAD_AUTHORITY_DEFAULT,
        createdAt: FIRST,
      });
      yield* bornThread(db, {
        id: second,
        ownerId: 'operator',
        agentId: 'tagma',
        spawnRootId: parent,
        parentThreadId: parent,
        authority: THREAD_AUTHORITY_DEFAULT,
        createdAt: SECOND,
      });

      const children = yield* threads.listByParent('operator', parent);
      expect(children.map((child) => child.id)).toEqual([first, second]);
      expect(children[0]?.provider).toBe('external');
      expect(children[1]?.provider).not.toBe('external');
    }),
  );

  it.effect('an external record answers its journal and an empty history, never a missing log', () =>
    Effect.gen(function* () {
      const { threads, events } = yield* StorageFixture;
      const id = 'ext-road-journal';
      yield* externalThread(id);
      yield* threads.transaction((tx) =>
        events.append(
          {
            threadId: id,
            id: 'ext-road-event-1',
            kind: 'message',
            payload: {
              entry: { type: 'message', id: 'ext-road-entry-1', role: 'user', text: 'first', occurredAt: '2026-08-30T00:00:00.000Z' },
            },
          },
          tx,
        ),
      );
      yield* threads.transaction((tx) =>
        events.append(
          {
            threadId: id,
            id: 'ext-road-event-2',
            kind: 'message',
            payload: {
              entry: { type: 'message', id: 'ext-road-entry-2', role: 'user', text: 'second', occurredAt: '2026-08-30T00:00:01.000Z' },
            },
          },
          tx,
        ),
      );

      expect(yield* threads.historyOf(id)).toEqual([]);
      const transcript = yield* threads.transcriptOf(id);
      expect(transcript?.map((entry) => entry.id)).toEqual(['ext-road-entry-1', 'ext-road-entry-2']);
      const page = yield* threads.transcriptWindow(id, { limit: 10, bytes: 1_000_000 });
      expect(page).not.toBeNull();
      expect(page?.entries.map((entry) => entry.id)).toEqual(['ext-road-entry-1', 'ext-road-entry-2']);
    }),
  );

  it.effect('an atomic update of an external record moves its status and preserves its shared log', () =>
    Effect.gen(function* () {
      const { db, fold } = yield* StorageFixture;
      const id = 'ext-road-atomic';
      yield* externalThread(id);

      let seen: unknown = null;
      const updated = yield* fold(id, (current) => {
        seen = current.history;
        return Effect.succeed({ status: 'failed' as const });
      });
      expect(seen).toEqual([]);
      expect(updated?.status).toBe('failed');
      expect(updated?.history).toEqual([]);

      const after = yield* record(id);
      expect(after?.status).toBe('failed');
      expect(after?.movedAt).not.toBeNull();

      const heldLog = yield* db.select().from(threadLog()).where(eq(threadLog().threadId, id));
      const heldEntries = yield* db.select().from(threadEntry()).where(eq(threadEntry().threadId, id));
      expect(heldLog.map((log) => log.threadId)).toEqual([id]);
      expect(heldEntries).toEqual([]);
    }),
  );

  it.effect('model settings persist on external and native kernel seats', () =>
    Effect.gen(function* () {
      const { db, threads } = yield* StorageFixture;
      const external = 'ext-road-patch-external';
      const native = 'ext-road-patch-native';
      yield* externalThread(external);
      yield* bornThread(db, {
        id: native,
        ownerId: 'operator',
        agentId: 'tagma',
        spawnRootId: native,
        authority: THREAD_AUTHORITY_DEFAULT,
      });
      yield* db.insert(threadLog()).values({ threadId: native });

      yield* threads.update(external, { model: 'x' });
      expect((yield* threads.find(external))?.model).toBe('x');

      yield* threads.update(native, { model: 'x' });
      expect((yield* threads.find(native))?.model).toBe('x');
    }),
  );

  it.effect('native and external inserts establish their kernel seat, mandate and log', () =>
    Effect.gen(function* () {
      const { threads } = yield* StorageFixture;
      const harnessed = yield* threads.insert({
        ownerId: 'operator',
        agentId: 'harness',
        provider: 'external',
        transport: { adapter: 'terminal', profile: 'codex', agent: null },
        capabilities: EXTERNAL_CAPABILITIES(),
      });
      expect(harnessed.provider).toBe('external');
      expect(yield* record(harnessed.id)).not.toBeUndefined();
      expect(yield* mandateOf(harnessed.id)).toEqual([{ id: harnessed.id }]);
      expect(yield* nativeOf(harnessed.id)).toEqual([{ id: harnessed.id }]);
      expect(yield* logOf(harnessed.id)).toEqual([{ threadId: harnessed.id }]);

      const natived = yield* threads.insert({ ownerId: 'operator', agentId: 'tagma' });
      expect(natived.provider).not.toBe('external');
      expect(yield* mandateOf(natived.id)).toEqual([{ id: natived.id }]);
      expect(yield* nativeOf(natived.id)).toEqual([{ id: natived.id }]);
      expect(yield* logOf(natived.id)).toEqual([{ threadId: natived.id }]);
    }),
  );

  it.effect('deleting an external record carries its mandate and session', () =>
    Effect.gen(function* () {
      const { threads } = yield* StorageFixture;
      const id = 'ext-road-delete';
      yield* externalThread(id);
      expect(yield* sessionOf(id)).toEqual([{ id }]);

      yield* threads.delete([id]);
      expect(yield* record(id)).toBeUndefined();
      expect(yield* mandateOf(id)).toEqual([]);
      expect(yield* sessionOf(id)).toEqual([]);
    }),
  );

  it.effect('appending history to an external seat persists it in the shared log', () =>
    Effect.gen(function* () {
      const { threads } = yield* StorageFixture;
      const id = 'ext-road-append';
      yield* externalThread(id);
      const message = Message.make({ role: 'user', content: 'held locally' });
      yield* threads.appendEntries(id, { history: [message] });
      expect(yield* threads.historyOf(id)).toEqual([message]);
      expect(yield* threads.transcriptOf(id)).toEqual([]);
    }),
  );

  it.effect('an observed external run shares the kernel ledger and moves its record to running', () =>
    Effect.gen(function* () {
      const { threads, records } = yield* StorageFixture;
      const id = 'ext-road-run';
      yield* externalThread(id);
      const row = yield* threads.find(id);
      if (row === undefined) return yield* Effect.die('the external record is missing');

      const runs = yield* threadRunStore({ kinds: ENTRY_KINDS, records, ownerId: 'operator', scope: sql`1 = 1` });
      const started = yield* runs.createRun({
        startFrom: row,
        kind: 'turn',
        origin: 'observed',
        approval: { mode: 'trust', interactive: false },
        progress: { stage: 'starting', message: 'go' },
      });
      expect(started).toMatchObject({
        _tag: 'Started',
        run: { threadId: id, origin: 'observed', status: 'running', provider: 'external' },
      });
      expect((yield* record(id))?.status).toBe('running');
    }),
  );

  it.effect('a seated record with no log fails instead of returning an empty history', () =>
    Effect.gen(function* () {
      const { db, threads } = yield* StorageFixture;
      const id = 'ext-road-no-log';
      yield* externalThread(id);
      yield* db.delete(threadLog()).where(eq(threadLog().threadId, id));
      const failure = yield* Effect.flip(threads.find(id));
      expect(failure.call).toBe('threadLog');
    }),
  );
});
