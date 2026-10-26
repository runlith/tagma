import { fixtureMigrations } from '../migrations.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { asc, eq } from 'drizzle-orm';
import { Message } from '@runlith/llm/schema/messages';
import { TranscriptFold } from '@runlith/agent/transcript/TranscriptFold';
import { threadEventFact } from '@runlith/agent/thread/ThreadEventDoor';
import type { ThreadEventBody } from '@runlith/agent/thread/events';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { threadLog, threadStore } from '../../../native-harness/testing/doubles.js';
import { threadEntry, sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadFolder } from '../../../native-harness/testing/fold.js';
import { ENTRY_KINDS } from '../../manifest.js';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations)));

const stand = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const threads = yield* threadStore(yield* makeThreadRecords, ENTRY_KINDS);
  return { threads, fold: yield* threadFolder(threads), events: yield* sqliteThreadJournal(), db };
});
type Stand = Effect.Success<typeof stand>;

const RUNS = ['run-1', 'run-2', 'run-3'] as const;

const spoken = (index: number) => {
  const role = index % 2 === 0 ? ('user' as const) : ('assistant' as const);
  return {
    id: `event-${index}`,
    kind: 'message',
    payload: {
      entry: {
        type: 'message' as const,
        id: `entry-${index}`,
        runId: RUNS[Math.floor(index / 2)]!,
        role,
        text: `line ${index}`,
        occurredAt: new Date(1_000 + index).toISOString(),
      },
      messages: [Message.make({ role, content: `line ${index}` })],
    },
  };
};

const LOG = Array.from({ length: 6 }, (_unused, index) => spoken(index));

const REWOUND = {
  id: 'rewind-1',
  kind: 'rewind',
  payload: { rewound: { id: 'rw-1', scope: 'from' as const, runIds: ['run-2', 'run-3'], cuts: [{ from: 2, to: 6 }] } },
};

const RESTORED = {
  id: 'restore-1',
  kind: 'restore',
  payload: {
    restored: {
      rewindId: 'rw-1',
      runIds: ['run-2', 'run-3'],
      inserts: [{ at: 2, messages: LOG.slice(2).flatMap((event) => event.payload.messages) }],
    },
  },
};

const append = (stand: Stand, threadId: string, events: readonly { id: string; kind: string; payload: object }[]) =>
  stand.threads.transaction((tx) =>
    Effect.forEach(events, (event) => stand.events.append({ threadId, ...event, id: `${threadId}-${event.id}` } as never, tx)),
  );

const touch = (stand: Stand, id: string) => stand.fold(id, (row) => Effect.succeed({ history: [...row.history] }));

const rowsOf = (stand: Stand, id: string) =>
  Effect.map(
    stand.db
      .select({ entry: threadEntry().entry })
      .from(threadEntry())
      .where(eq(threadEntry().threadId, id))
      .orderBy(asc(threadEntry().ord)),
    (rows) => rows.map((row) => row.entry),
  );

const folded = (events: readonly { kind: string; payload: object }[]) => {
  const fold = new TranscriptFold([]);
  for (const event of events) fold.place(threadEventFact(event as ThreadEventBody));
  return [...fold.take()];
};

const MARK = { by: 'rw-1', scope: 'from' } as const;

layer(storage, { excludeTestServices: true })('rewind rows', (it) => {
  it.effect('a rewind marks its runs in the rows, the history loses their messages, and restore returns both exactly', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const { threads } = fixture;
      const thread = yield* threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* append(fixture, thread.id, LOG);
      yield* touch(fixture, thread.id);
      const rowsBefore = yield* rowsOf(fixture, thread.id);
      const historyBefore = yield* threads.historyOf(thread.id);
      expect(historyBefore).toHaveLength(6);

      yield* append(fixture, thread.id, [REWOUND]);
      const unprojected = yield* threads.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 });
      expect(unprojected?.entries.map((entry) => entry.rewound ?? null)).toEqual([null, null, MARK, MARK, MARK, MARK]);

      yield* touch(fixture, thread.id);
      expect(yield* rowsOf(fixture, thread.id)).toEqual(folded([...LOG, REWOUND]));
      expect(yield* threads.historyOf(thread.id)).toEqual(historyBefore!.slice(0, 2));

      yield* append(fixture, thread.id, [RESTORED]);
      yield* touch(fixture, thread.id);
      expect(yield* rowsOf(fixture, thread.id)).toEqual(rowsBefore);
      expect(yield* threads.historyOf(thread.id)).toEqual(historyBefore);
    }),
  );

  it.effect('rows derived again from the log after a restart equal the kernel fold', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const { threads, db } = fixture;
      const thread = yield* threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* append(fixture, thread.id, [...LOG, REWOUND]);
      yield* touch(fixture, thread.id);
      const standing = yield* rowsOf(fixture, thread.id);

      yield* db.delete(threadEntry()).where(eq(threadEntry().threadId, thread.id));
      yield* db.update(threadLog()).set({ entriesThrough: 0 }).where(eq(threadLog().threadId, thread.id));
      yield* touch(fixture, thread.id);

      expect(yield* rowsOf(fixture, thread.id)).toEqual(standing);
      expect(standing).toEqual(folded([...LOG, REWOUND]));
    }),
  );

  const CALL = {
    type: 'tool' as const,
    id: 'tool:c1',
    runId: 'run-1',
    toolName: 'read',
    toolCallId: 'c1',
    toolState: 'input-available' as const,
    toolInput: { filePath: '/a' },
    occurredAt: '2026-09-10T10:00:00.000Z',
  };

  const SETTLED = { ...CALL, toolState: 'output-available' as const, toolOutput: { text: 'x'.repeat(2_000) } };

  it.effect('a rewound and restored tool call keeps its whole body in the row', () =>
    Effect.gen(function* () {
      const fixture = yield* stand;
      const thread = yield* fixture.threads.insert({ ownerId: 'owner', agentId: 'agent' });
      yield* append(fixture, thread.id, [{ id: 'call', kind: 'tool', payload: { entry: CALL } }]);
      yield* touch(fixture, thread.id);
      yield* append(fixture, thread.id, [{ id: 'settled', kind: 'tool', payload: { entry: SETTLED } }]);
      yield* touch(fixture, thread.id);
      const [standing] = yield* rowsOf(fixture, thread.id);
      expect(standing).toMatchObject({ toolOutput: { text: 'x'.repeat(2_000) } });

      yield* append(fixture, thread.id, [
        { id: 'rewind', kind: 'rewind', payload: { rewound: { id: 'rw-1', scope: 'turn', runIds: ['run-1'], cuts: [] } } },
      ]);
      yield* touch(fixture, thread.id);
      expect((yield* rowsOf(fixture, thread.id))[0]).toEqual({ ...standing!, rewound: { by: 'rw-1', scope: 'turn' } });

      yield* append(fixture, thread.id, [
        { id: 'restore', kind: 'restore', payload: { restored: { rewindId: 'rw-1', runIds: ['run-1'], inserts: [] } } },
      ]);
      yield* touch(fixture, thread.id);
      expect(yield* rowsOf(fixture, thread.id)).toEqual([standing!]);
    }),
  );
});
