import { fixtureMigrations } from '../migrations.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { describe, expect } from 'bun:test';
import { Effect, FileSystem, Layer } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { ENTRY_KINDS } from '../../manifest.js';
import { asc, eq, sql } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { project } from '../../../projects/testing/doubles.js';
import { threadRecord } from '../../../thread-record/store/table.js';
import { thread as nativeThread } from '../../../threads/store/kernel.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { recordOf } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { asExternalSession } from '../../../threads/testing/doubles.js';
import { unmeasuredObservation } from '../../../threads/testing/doubles.js';
import { createRollout } from '../../../threads/testing/doubles.js';
import { exportThreadRollout } from '../../../threads/testing/doubles.js';
import { rehydrateThreadRecords, replayThreadRollout, rolloutForms } from '../../../threads/testing/doubles.js';
import type { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { externalRolloutPart } from '../../../external-harnesses/rollout.js';
import { threadEvent, threadRolloutCursor } from '../../../threads/testing/doubles.js';
import { externalSession } from '../../../threads/testing/doubles.js';
import { sessionFor } from '../../../external-harnesses/testing/sessions.js';
import { acpTestKernel as acpKernel } from '../../../external-harnesses/testing/seats.js';
import { harnessFacet } from '../../../threads/contract/wire/harness/types.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';

const parts = { native: nativeOnlyParts.native, external: externalRolloutPart };

const fixture = Layer.mergeAll(
  BunFileSystem.layer,
  Layer.succeed(ThreadEntryKinds, ENTRY_KINDS),
  unitsLayer(MachineUnits, MachineStore).pipe(
    Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
  ),
);

const imported = Effect.fnUntraced(function* (threadId: string, path: string, records: ThreadRecords['Service']) {
  yield* (yield* rolloutForms((_id, work) => work, ENTRY_KINDS)).formedHere(threadId, path);
  return yield* replayThreadRollout({ path, parts, records });
});

const endedFacet = (failure: string | null): ReturnType<typeof asExternalSession> =>
  ({
    name: 'claude-code',
    transport: 'terminal',
    sessionKey: 'k',
    session: {
      id: 's-1',
      origin: 'launched',
      state: 'ended',
      prompt: '',
      cwd: null,
      argv: null,
      reported: false,
      ownerId: null,
      startedAt: '2026-08-25T10:00:00.000Z',
      heartbeatAt: '2026-08-25T10:00:00.000Z',
      finishedAt: '2026-08-25T10:00:01.000Z',
      outcome: 'failed',
      failure,
    },
    execution: null,
    observation: unmeasuredObservation(),
  }) as unknown as ReturnType<typeof asExternalSession>;

describe('the external rollout part', () => {
  it.live('an old external rollout copy comes in without the session outcome, failure and report flag', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const db = (yield* MachineStore).db;
      const records = yield* makeThreadRecords;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* db
        .insert(project())
        .values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born })
        .returning()
        .get();
      const at = born.toISOString();
      const oldThread = (id: string) => ({
        id,
        ownerId: 'owner',
        agentId: 'harness',
        parentThreadId: null,
        spawnRootId: id,
        name: null,
        authority: { mode: 'trust', bypassFrom: null },
        budgetTokens: null,
        hostKind: null,
        hostId: null,
        provider: 'external',
        status: 'idle',
        failureReason: 'boom',
        createdAt: at,
        updatedAt: at,
      });
      const oldFacet = (harness: ReturnType<typeof asExternalSession>) => ({
        projectId: (registered as { id: number }).id,
        title: 'external past',
        readerOrderAt: at,
        harness,
      });
      const settled = join(yield* files.makeTempDirectoryScoped({ prefix: 'rollout-ext-settle-' }), 't-ext-boom.jsonl');
      yield* createRollout(settled, { thread: oldThread('t-ext-boom'), facet: oldFacet(endedFacet(null)), session: null });
      const kept = join(yield* files.makeTempDirectoryScoped({ prefix: 'rollout-ext-kept-' }), 't-ext-kept.jsonl');
      yield* createRollout(kept, { thread: oldThread('t-ext-kept'), facet: oldFacet(endedFacet('other')), session: null });

      expect((yield* imported('t-ext-boom', settled, records)).threadId).toBe('t-ext-boom');
      expect((yield* imported('t-ext-kept', kept, records)).threadId).toBe('t-ext-kept');

      expect((yield* recordOf(db, 't-ext-boom'))?.harness).toBe('claude-code');
      expect((yield* recordOf(db, 't-ext-kept'))?.harness).toBe('claude-code');
      for (const id of ['t-ext-boom', 't-ext-kept']) {
        const kernel = yield* db
          .select({ transport: nativeThread.transport, capabilities: nativeThread.capabilities })
          .from(nativeThread)
          .where(eq(nativeThread.id, id));
        expect(kernel.map((row) => row.transport)).toEqual([{ adapter: 'terminal', profile: 'claude-code', agent: null }]);
        expect(kernel[0]?.capabilities).toEqual({
          messaging: true,
          judgedModel: false,
          steer: 'step',
          withdraw: false,
          history: 'session',
          copies: { whole: 'record', point: 'record' },
          compaction: 'none',
          modelMove: 'pinned',
          openings: 'core-and-observed',
          pictures: false,
          web: 'none',
          law: 'asked-calls',
          touch: 'reads-and-writes',
          authorship: 'observed',
          callEnvelopeMs: null,
          screen: true,
          continue: true,
          feed: 'turns',
          usage: 'partial',
          aside: 'none',
        });
      }

      const settledSession = yield* db.select().from(externalSession()).where(eq(externalSession().id, 't-ext-boom')).get();
      expect(settledSession?.facet.session).not.toHaveProperty('failure');
      expect(settledSession?.facet.session).not.toHaveProperty('outcome');
      expect(settledSession?.facet.session).not.toHaveProperty('reported');
      expect(settledSession?.facet.observation).not.toHaveProperty('work');
      const keptSession = yield* db.select().from(externalSession()).where(eq(externalSession().id, 't-ext-kept')).get();
      expect(keptSession?.facet.session).not.toHaveProperty('finishedAt');
    }).pipe(Effect.provide(fixture)),
  );

  it.live('an old hosted acp rollout comes in bound, with its model, capabilities and host moved to the kernel row', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const db = (yield* MachineStore).db;
      const records = yield* makeThreadRecords;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* db
        .insert(project())
        .values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born })
        .returning()
        .get();
      const at = born.toISOString();
      const harness = {
        ...endedFacet(null),
        name: 'claude',
        transport: 'acp',
        hosts: 'tagma',
        asked: { model: 'sonnet', reasoning: 'high' },
        proves: { fork: true, rewind: true, compaction: true, law: 'every-call', touch: 'writes', authorship: 'observed' },
      };
      const path = join(yield* files.makeTempDirectoryScoped({ prefix: 'rollout-ext-acp-' }), 't-ext-acp.jsonl');
      yield* createRollout(path, {
        thread: {
          id: 't-ext-acp',
          ownerId: 'owner',
          agentId: 'harness',
          parentThreadId: null,
          spawnRootId: 't-ext-acp',
          name: null,
          authority: { mode: 'trust', bypassFrom: null },
          budgetTokens: null,
          hostKind: null,
          hostId: null,
          provider: 'external',
          status: 'idle',
          failureReason: null,
          createdAt: at,
          updatedAt: at,
        },
        facet: { projectId: (registered as { id: number }).id, title: 'acp past', readerOrderAt: at, harness },
        session: null,
      });
      yield* imported('t-ext-acp', path, records);

      const kernel = yield* db.select().from(nativeThread).where(eq(nativeThread.id, 't-ext-acp')).get();
      expect(kernel?.transport).toEqual({ adapter: 'acp', profile: 'claude-code', agent: 'tagma' });
      expect([kernel?.provider, kernel?.model, kernel?.reasoning]).toEqual(['claude-code', 'sonnet', 'high']);
      expect(kernel?.capabilities).toEqual({
        messaging: true,
        judgedModel: false,
        steer: 'step',
        withdraw: true,
        history: 'session',
        compaction: 'session',
        modelMove: 'live',
        openings: 'core',
        pictures: true,
        web: 'vendor',
        law: 'every-call',
        touch: 'writes',
        authorship: 'observed',
        callEnvelopeMs: 1_200_000,
        screen: false,
        continue: true,
        feed: 'full',
        usage: 'measured',
        aside: 'session',
      });
      const facet = (yield* db.select().from(externalSession()).where(eq(externalSession().id, 't-ext-acp')).get())?.facet as Record<
        string,
        unknown
      >;
      expect(['transport', 'hosts', 'proves', 'asked'].filter((key) => key in facet)).toEqual([]);
    }).pipe(Effect.provide(fixture)),
  );

  it.live(
    'a current-form acp thread keeps its facet and kernel row across export and replay, and a running terminal session comes back at rest',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const db = (yield* MachineStore).db;
        const records = yield* makeThreadRecords;
        const born = new Date('2026-08-25T10:00:00.000Z');
        const registered = yield* db
          .insert(project())
          .values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born })
          .returning()
          .get();
        const birth = (id: string) =>
          bornThread(
            db,
            {
              id,
              ownerId: 'owner',
              agentId: 'harness',
              authority: { mode: 'trust', bypassFrom: null },
              spawnRootId: id,
              cacheGroup: id,
              status: 'idle',
              createdAt: born,
              updatedAt: born,
            },
            { projectId: (registered as { id: number }).id, title: id },
          );
        yield* birth('t-acp-now');
        yield* sessionFor(
          db,
          't-acp-now',
          harnessFacet('claude-code', harnessPresentation(builtinHarness('claude-code'))),
          acpKernel('claude-code', 'tagma', { model: 'sonnet', reasoning: 'high' }),
        );
        yield* birth('t-term-live');
        const running = {
          ...endedFacet(null),
          session: { ...endedFacet(null).session!, state: 'running', ownerId: 'server', finishedAt: null, outcome: null },
        };
        yield* sessionFor(db, 't-term-live', running as ReturnType<typeof asExternalSession>);
        const before = {
          facet: yield* db.select().from(externalSession()).where(eq(externalSession().id, 't-acp-now')).get(),
          kernel: yield* db.select().from(nativeThread).where(eq(nativeThread.id, 't-acp-now')).get(),
        };

        for (const id of ['t-acp-now', 't-term-live']) {
          const path = join(yield* files.makeTempDirectoryScoped({ prefix: 'rollout-ext-form-' }), `${id}.jsonl`);
          yield* exportThreadRollout({ threadId: id, path, parts });
          yield* db.delete(threadRecord).where(eq(threadRecord.id, id));
          yield* imported(id, path, records);
        }

        expect(yield* db.select().from(externalSession()).where(eq(externalSession().id, 't-acp-now')).get()).toEqual(before.facet);
        const kernel = yield* db.select().from(nativeThread).where(eq(nativeThread.id, 't-acp-now')).get();
        expect(kernel?.transport).toEqual(before.kernel?.transport);
        expect(kernel?.capabilities).toEqual(before.kernel?.capabilities);
        expect([kernel?.provider, kernel?.model, kernel?.reasoning]).toEqual(['claude-code', 'sonnet', 'high']);

        const stored = yield* db.select().from(externalSession()).where(eq(externalSession().id, 't-term-live')).get();
        const live = stored?.facet as ReturnType<typeof asExternalSession>;
        expect([live.session?.state, stored?.leaseOwner, live.execution]).toEqual(['ended', null, null]);
      }).pipe(Effect.provide(fixture)),
  );

  it.live('a new external rollout keeps its record and session across export and replay', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const db = (yield* MachineStore).db;
      const records = yield* makeThreadRecords;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* db
        .insert(project())
        .values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born })
        .returning()
        .get();
      yield* bornThread(
        db,
        {
          id: 't-ext-new',
          ownerId: 'owner',
          agentId: 'harness',
          authority: { mode: 'trust', bypassFrom: null },
          spawnRootId: 't-ext-new',
          cacheGroup: 't-ext-new',
          status: 'idle',
          createdAt: born,
          updatedAt: born,
        },
        { projectId: (registered as { id: number }).id, title: 'external now' },
      );
      const facet: ReturnType<typeof asExternalSession> = {
        name: 'claude-code',
        presentation: harnessPresentation(builtinHarness('claude-code')),
        sessionKey: 'k-new',
        session: {
          id: 's-new',
          origin: 'launched',
          state: 'ended',
          prompt: '',
          cwd: null,
          argv: null,
          ownerId: null,
          startedAt: born.toISOString(),
          heartbeatAt: born.toISOString(),
        },
        execution: null,
        observation: unmeasuredObservation(),
      };
      yield* sessionFor(db, 't-ext-new', facet);
      const before = {
        record: yield* db.select().from(threadRecord).where(eq(threadRecord.id, 't-ext-new')),
        stored: yield* db.select().from(externalSession()).where(eq(externalSession().id, 't-ext-new')),
      };

      const path = join(yield* files.makeTempDirectoryScoped({ prefix: 'rollout-ext-new-' }), 't-ext-new.jsonl');
      const exported = yield* exportThreadRollout({ threadId: 't-ext-new', path, parts });
      expect(exported.records).toBe(0);

      yield* db.delete(threadRecord);
      yield* replayThreadRollout({ path, parts, records });
      expect(yield* db.select().from(threadRecord).where(eq(threadRecord.id, 't-ext-new'))).toEqual(before.record);
      expect(yield* db.select().from(externalSession()).where(eq(externalSession().id, 't-ext-new'))).toEqual(before.stored);
      expect(
        (yield* db.select({ transport: nativeThread.transport }).from(nativeThread).where(eq(nativeThread.id, 't-ext-new'))).map(
          (row) => row.transport,
        ),
      ).toEqual([{ adapter: 'terminal', profile: 'claude-code', agent: null }]);
    }).pipe(Effect.provide(fixture)),
  );

  it.live('a terminal journal carries its events across export and rehydrate with its folds', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const db = (yield* MachineStore).db;
      const records = yield* makeThreadRecords;
      const born = new Date('2026-08-25T10:00:00.000Z');
      const registered = yield* db
        .insert(project())
        .values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: born })
        .returning()
        .get();
      yield* bornThread(
        db,
        {
          id: 't-ext-journal',
          ownerId: 'owner',
          agentId: 'harness',
          authority: { mode: 'trust', bypassFrom: null },
          spawnRootId: 't-ext-journal',
          cacheGroup: 't-ext-journal',
          status: 'idle',
          createdAt: born,
          updatedAt: born,
        },
        { projectId: (registered as { id: number }).id, title: 'external journal' },
      );
      yield* sessionFor(db, 't-ext-journal', endedFacet(null));
      const event = (position: number, id: string, entryId: string, text: string) => ({
        threadId: 't-ext-journal',
        position,
        id,
        kind: 'message',
        payload: {
          entry: {
            type: 'message',
            id: entryId,
            role: 'user',
            text,
            occurredAt: '2026-08-25T10:00:00.000Z',
          },
        },
      });
      yield* db
        .insert(threadEvent())
        .values([event(1, 'ext-roll-event-1', 'ext-roll-entry-1', 'first'), event(2, 'ext-roll-event-2', 'ext-roll-entry-2', 'second')]);

      const path = join(yield* files.makeTempDirectoryScoped({ prefix: 'rollout-ext-journal-' }), 't-ext-journal.jsonl');
      const exported = yield* exportThreadRollout({ threadId: 't-ext-journal', path, parts });
      expect(exported.records).toBe(2);

      yield* db.delete(threadEvent()).where(eq(threadEvent().threadId, 't-ext-journal'));
      yield* rehydrateThreadRecords({ threadId: 't-ext-journal', path, parts });

      const events = yield* db
        .select()
        .from(threadEvent())
        .where(eq(threadEvent().threadId, 't-ext-journal'))
        .orderBy(asc(threadEvent().position));
      expect(events.map((row) => row.id)).toEqual(['ext-roll-event-1', 'ext-roll-event-2']);
      const cursor = yield* db.select().from(threadRolloutCursor()).where(eq(threadRolloutCursor().threadId, 't-ext-journal')).get();
      expect(cursor?.nextPosition).toBe(3);
      expect(yield* db.all(sql`select thread_id from thread_log where thread_id = ${'t-ext-journal'}`)).toHaveLength(1);
      expect(yield* db.all(sql`select thread_id, ord from thread_entry where thread_id = ${'t-ext-journal'}`)).toHaveLength(2);
    }).pipe(Effect.provide(fixture)),
  );
});
