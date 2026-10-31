import { fixtureMigrations } from '../migrations.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { DateTime, Effect, Layer, Tracer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { eq, sql } from 'drizzle-orm';
import { Message } from '@runlith/llm/schema/messages';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import { threadHistory, threadLog, threadStore } from '../../../native-harness/testing/doubles.js';
import { threadEntry } from '../../../threads/testing/doubles.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadFolder } from '../../../native-harness/testing/fold.js';
import { restFor } from '../../../threads/testing/rest.js';
import { journalSteps, rolloutForms, sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import { makeThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { ENTRY_KINDS } from '../composed.js';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)),
);

layer(storage, { excludeTestServices: true })('thread storage', (it) => {
  it.effect('thread storage exposes append, checkpoint and suffix phases, per fold', () =>
    Effect.gen(function* () {
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const thread = yield* Effect.gen(function* () {
        const records = yield* makeThreadRecords;
        const threads = yield* threadStore(records, ENTRY_KINDS);
        const fold = yield* threadFolder(threads);
        const events = yield* sqliteThreadJournal();
        const row = yield* threads.insert({ ownerId: 'owner', agentId: 'agent', provider: 'provider' });
        yield* threads.transaction((tx) =>
          events.append(
            {
              threadId: row.id,
              id: `${row.id}-event-1`,
              kind: 'message',
              payload: {
                entry: {
                  type: 'message',
                  id: 'entry-1',
                  role: 'user',
                  text: 'hello',
                  occurredAt: '2026-08-30T00:00:00.000Z',
                },
              },
            },
            tx,
          ),
        );
        expect(((yield* threads.transcriptOf(row.id)) ?? []).map((entry) => entry.id)).toEqual(['entry-1']);
        yield* fold(row.id, (current) => Effect.succeed({ history: [...current.history] }));
        return row;
      }).pipe(Effect.withTracer(tracer));

      const phases = spans
        .filter((span) => span.name.startsWith('ThreadStorage.'))
        .map((span) => ({ name: span.name, attributes: Object.fromEntries(span.attributes) }));
      const phase = (name: string, fold?: string) =>
        phases.find((span) => span.name === name && (fold === undefined || span.attributes.fold === fold))?.attributes;

      expect(phase('ThreadStorage.append')).toMatchObject({ threadId: thread.id, events: 1 });
      expect(phase('ThreadStorage.checkpoint.load', 'history')).toMatchObject({ threadId: thread.id });
      expect(phase('ThreadStorage.checkpoint.load', 'entries')).toMatchObject({ threadId: thread.id });
      expect(phase('ThreadStorage.suffix.replay', 'entries')).toMatchObject({ threadId: thread.id, events: 1 });
      expect(phase('ThreadStorage.suffix.replay', 'history')).toMatchObject({ threadId: thread.id });
      expect(phase('ThreadStorage.checkpoint.write')).toMatchObject({ threadId: thread.id });
    }),
  );

  it.effect('an entry the log carries above the entries cursor is answered by every read of the fold', () =>
    Effect.gen(function* () {
      const store = yield* MachineStore;
      const threads = yield* threadStore(yield* makeThreadRecords, ENTRY_KINDS);
      const events = yield* sqliteThreadJournal();
      const row = yield* threads.insert({ ownerId: 'owner', agentId: 'agent', provider: 'provider' });
      const entry = {
        type: 'message',
        id: 'entry-1',
        runId: 'run-1',
        role: 'user',
        text: 'hello',
        occurredAt: '2026-08-30T00:00:00.000Z',
      };
      yield* threads.transaction((tx) =>
        events.append({ threadId: row.id, id: `${row.id}-event-1`, kind: 'message', payload: { entry } }, tx),
      );

      expect(yield* store.db.select().from(threadEntry()).where(eq(threadEntry().threadId, row.id))).toEqual([]);
      expect((yield* store.db.select().from(threadLog()).where(eq(threadLog().threadId, row.id)).get())?.entriesThrough).toBe(0);
      expect(((yield* threads.transcriptOf(row.id)) ?? []).map((held) => held.id)).toEqual(['entry-1']);
      expect((yield* threads.entriesOfRun(row.id, 'run-1')).map((held) => held.id)).toEqual(['entry-1']);
      expect((yield* threads.entryById(row.id, 'entry-1'))?.id).toBe('entry-1');
      expect(yield* threads.entriesOfRun(row.id, 'run-2')).toEqual([]);
      expect(yield* threads.entryById(row.id, 'entry-2')).toBeUndefined();
    }),
  );

  it.effect('a standing thread with no fold names the eviction, and names the loss when nothing was evicted', () =>
    Effect.gen(function* () {
      const store = yield* MachineStore;
      const threads = yield* threadStore(yield* makeThreadRecords, ENTRY_KINDS);
      const at = DateTime.toDateUtc(yield* DateTime.now);
      const registered = yield* store.db
        .insert(project())
        .values({ name: 'p', repoKey: '/p', rootPath: '/p', createdAt: at })
        .returning()
        .get();
      const row = yield* threads.insert({ ownerId: 'owner', agentId: 'agent', provider: 'provider' });
      yield* scopeRecord(store.db, row.id, { projectId: registered.id, title: 'the rested thread' });

      yield* store.db.delete(threadLog()).where(eq(threadLog().threadId, row.id));
      const lost = yield* Effect.flip(threads.find(row.id));
      yield* restFor(store.db, row.id, at);
      const evicted = yield* Effect.flip(threads.find(row.id));
      expect({ lost: lost.call, evicted: evicted.call }).toEqual({ lost: 'threadLog', evicted: 'projection-evicted' });
    }),
  );

  it.effect('a stored history row the fold cannot read fails the load as ThreadStorageFailed, not as a defect', () =>
    Effect.gen(function* () {
      const store = yield* MachineStore;
      const units = yield* MachineUnits;
      const threads = yield* threadStore(yield* makeThreadRecords, ENTRY_KINDS);
      const row = yield* threads.insert({ ownerId: 'owner', agentId: 'agent', provider: 'provider' });
      yield* units.write('test.seed', (unit) => threads.folds.history.seed(unit, row.id, [Message.user('hello'), Message.assistant('hi')]));
      yield* store.db.run(
        sql`update thread_history_item set message = '{"role":"someone","content":"x"}' where thread_id = ${row.id} and ord = 1`,
      );

      const history = yield* threadHistory(ENTRY_KINDS);
      const failure = yield* Effect.flip(units.read((unit) => history.read(unit, row.id)));
      expect(failure._tag).toBe('ThreadStorageFailed');
    }),
  );

  it.effect('a thread born through the store stands at the current journal form step and is not brought whole again', () =>
    Effect.gen(function* () {
      const kinds = makeThreadEntryReader({
        products: [],
        steps: journalSteps([
          [
            {
              name: '20261010170000_message_when',
              samples: { entry: { type: 'message', when: 'then' } },
              entry: (entry) => {
                if (entry.type !== 'message' || entry.when === undefined) return null;
                const { when, ...rest } = entry;
                return { ...rest, occurredAt: when };
              },
            },
          ],
        ]),
      });
      const threads = yield* threadStore(yield* makeThreadRecords, kinds);
      const forms = yield* rolloutForms((_threadId, work) => work, kinds);
      const row = yield* threads.insert({ ownerId: 'owner', agentId: 'agent', provider: 'provider' });

      expect(yield* forms.lags(row.id)).toBe(false);
    }),
  );
});
