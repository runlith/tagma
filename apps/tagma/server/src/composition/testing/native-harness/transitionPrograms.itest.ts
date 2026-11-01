import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Cause, Effect, Exit, Layer } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { CostLedger, costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { readThreadEvents, threadEntryEvent, threadStepMessagesEvent } from '@runlith/agent/thread/events';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import { callKey, type Evidence } from '@runlith/agent/thread/keyed';
import { sealThreadEvents } from '@runlith/agent/thread/ThreadEventDoor';
import { type TransitionDeps, transitionNow } from '@runlith/agent/thread/transition/kernel';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import { OWNER, SCOPE } from '@runlith/agent/thread/conformance/runLog/world';
import { openThreadStore } from '../storageHarness.js';
import { programWriteUnit } from '../../../platform/store/programs.js';
import { ProgramConflict } from '../../../platform/contract/service/units.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { thread as threadTable } from '../../../threads/testing/doubles.js';
import { threadMetadata } from '../../../native-harness/testing/doubles.js';

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
  toolOutput: { text: 'the file' },
};

const opened = Effect.gen(function* () {
  const { storage, db } = yield* openThreadStore();
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
  const runs = storage.runs({ ownerId: OWNER, scope: SCOPE });
  const start = yield* runs.createRun({
    kind: 'turn',
    startFrom: {
      id: thread.id,
      ownerId: thread.ownerId,
      account: thread.account,
      provider: thread.provider,
      model: thread.model,
      reasoning: thread.reasoning,
      switches: thread.switches ?? {},
    },
    approval: { mode: 'trust', interactive: false },
    progress: { stage: 'starting', message: null },
  });
  const deps: TransitionDeps<Unit<'machine'>, WriteUnit<'machine'>> = {
    store: storage.aggregate,
    log: storage.eventLog,
    transitions: storage.transitions,
    lane: {
      place: () => ({ at: 0 }),
      enter: (_threadId, _place, work) => Effect.map(work, (ran) => ({ ran })),
      order: (_threadId, work) => work,
    },
    kinds: storage.kinds,
  };
  const step = (decidedBy: string, moved?: () => Effect.Effect<void, unknown>, evidence: Evidence = { decidedBy: `test:${decidedBy}` }) =>
    transitionNow(
      deps,
      thread.id,
      {
        declared: sealThreadEvents([threadStepMessagesEvent([Message.assistant(decidedBy)])!]),
        decide: Effect.fnUntraced(function* (_view: unknown, tx: WriteUnit<'machine'>) {
          const standing = yield* runs.latestRun(thread.id, ['running'], tx);
          if (moved !== undefined) yield* Effect.orDie(moved());
          return standing?.ownerId === OWNER ? { apply: true as const, result: 'applied' } : { refuse: 'refused' };
        }),
      },
      { evidence, digest: decidedBy },
    );
  const entryStep = (entry: ThreadToolEntry) =>
    transitionNow(
      deps,
      thread.id,
      {
        declared: sealThreadEvents([threadEntryEvent(entry)]),
        decide: Effect.fnUntraced(function* (_view: unknown, tx: WriteUnit<'machine'>) {
          const standing = yield* runs.latestRun(thread.id, ['running'], tx);
          return standing?.ownerId === OWNER ? { apply: true as const, result: 'applied' } : { refuse: 'refused' };
        }),
      },
      { evidence: { decidedBy: `test:${entry.toolState}` }, digest: entry.toolState },
    );
  const readingStep = (reading: ThreadContextReading | null) =>
    transitionNow(
      deps,
      thread.id,
      {
        declared: sealThreadEvents([threadStepMessagesEvent([Message.assistant('read')])!]),
        decide: Effect.fnUntraced(function* (_view: unknown, tx: WriteUnit<'machine'>) {
          const standing = yield* runs.latestRun(thread.id, ['running'], tx);
          return standing?.ownerId === OWNER
            ? { apply: true as const, result: 'applied', patch: { contextReading: reading } }
            : { refuse: 'refused' };
        }),
      },
      { evidence: { decidedBy: 'test:reading' }, digest: 'reading' },
    );
  const storedReading = Effect.map(
    db.all<{ reading: string | null; kind: string }>(
      sql`select context_reading as reading, typeof(context_reading) as kind from native_thread where id = ${thread.id}`,
    ),
    ([row]) => ({ kind: row?.kind, value: row?.reading == null ? null : JSON.parse(row.reading) }),
  );
  const cursor = Effect.gen(function* () {
    const [log] = yield* db.all<{ through: number; head: number }>(
      sql`select entries_through as through, (select max(position) from thread_event where thread_id = ${thread.id}) as head
        from thread_log where thread_id = ${thread.id}`,
    );
    return log;
  });
  const journal = readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 100);
  return { storage, db, thread, run: start.run, step, entryStep, readingStep, storedReading, cursor, journal, deps };
});

it.live('a transition whose reads are planned commits as one program and no interactive unit', () =>
  Effect.gen(function* () {
    const { storage, thread, step } = yield* opened;
    const outcome = yield* rootCost('test.transition', step('planned'), 'test-root');
    const [row] = (yield* CostLedger).read({ rootId: 'test-root', limit: 1 }).rows;
    expect(outcome).toEqual({ committed: 'applied' });
    expect({ programs: row?.total.programs, units: row?.total.units }).toEqual({ programs: 1, units: 0 });
    expect((yield* storage.aggregate.historyOf(thread.id))?.map((message) => message.role)).toEqual(['assistant']);
  }).pipe(Effect.provide(Layer.fresh(costLedgerLayer({ capacity: 16 })))),
);

it.live('a transition repeated under its key after its program committed answers the recorded outcome and applies nothing again', () =>
  Effect.gen(function* () {
    const { storage, thread, step } = yield* opened;
    const evidence: Evidence = { call: callKey({ operation: 'test', actor: thread.id, key: 'once' }) };
    const first = yield* step('committed', undefined, evidence);
    const repeated = yield* step('committed', undefined, evidence);
    expect({ first, repeated }).toEqual({ first: { committed: 'applied' }, repeated: { replayed: 'applied' } });
    expect((yield* storage.aggregate.historyOf(thread.id))?.map((message) => message.role)).toEqual(['assistant']);
  }),
);

it.live('a transition repeated under its key answers the recorded outcome even when its decision would now fail', () =>
  Effect.gen(function* () {
    const { thread, step, deps } = yield* opened;
    const evidence: Evidence = { call: callKey({ operation: 'test', actor: thread.id, key: 'settled' }) };
    yield* step('settled', undefined, evidence);
    const repeated = yield* transitionNow(
      deps,
      thread.id,
      {
        declared: sealThreadEvents([threadStepMessagesEvent([Message.assistant('settled')])!]),
        decide: () => Effect.fail('the entry the first act settled is gone'),
      },
      { evidence, digest: 'settled' },
    );
    expect(repeated).toEqual({ replayed: 'applied' });
  }),
);

it.live('a decision whose dependency moved while its thread did not is refused at commit and decided again', () =>
  Effect.gen(function* () {
    const { storage, db, thread, run, step } = yield* opened;
    let moves = 0;
    const outcome = yield* step('guarded', () =>
      moves++ === 0 ? db.run(sql`update thread_run set owner_id = 'elsewhere' where id = ${run.id}`) : Effect.void,
    );
    expect(outcome).toEqual({ refused: 'refused' });
    expect(yield* storage.aggregate.historyOf(thread.id)).toEqual([]);
  }),
);

it.live('a planned transcript entry is inserted, replaced and folded by its program, and the cursor follows the journal', () =>
  Effect.gen(function* () {
    const { storage, thread, entryStep, cursor, journal } = yield* opened;
    const placed = yield* rootCost('test.transition', entryStep(CALL), 'test-insert');
    const first = { entry: yield* storage.aggregate.entryById(thread.id, CALL.id), cursor: yield* cursor, events: yield* journal };
    const settled = yield* rootCost('test.transition', entryStep(SETTLED), 'test-replace');
    const second = { entry: yield* storage.aggregate.entryById(thread.id, CALL.id), cursor: yield* cursor, events: yield* journal };
    const ledger = yield* CostLedger;
    const costs = ['test-insert', 'test-replace'].map((rootId) => {
      const total = ledger.read({ rootId, limit: 1 }).rows[0]?.total;
      return { programs: total?.programs, units: total?.units };
    });
    expect({ placed, settled }).toEqual({ placed: { committed: 'applied' }, settled: { committed: 'applied' } });
    expect(costs).toEqual([
      { programs: 1, units: 0 },
      { programs: 1, units: 0 },
    ]);
    expect(first.entry).toEqual(CALL);
    expect(first.cursor).toEqual({ through: 1, head: 1 });
    expect(first.events.map((event) => ({ position: event.position, entry: (event.payload as { entry?: unknown }).entry }))).toEqual([
      { position: 1, entry: CALL },
    ]);
    expect(second.entry).toEqual(SETTLED);
    expect(second.cursor).toEqual({ through: 2, head: 2 });
    expect(second.events.map((event) => ({ position: event.position, entry: (event.payload as { entry?: unknown }).entry }))).toEqual([
      { position: 1, entry: CALL },
      { position: 2, entry: SETTLED },
    ]);
  }).pipe(Effect.provide(Layer.fresh(costLedgerLayer({ capacity: 16 })))),
);

const READING: ThreadContextReading = {
  usage: { inputTokens: 1200, outputTokens: 80, visibleOutputTokens: 80 },
  contextWindow: 200_000,
  runId: 'run-1',
  stepNumber: 3,
  provider: null,
  model: null,
  measuredAt: '2026-11-01T00:00:00.000Z',
  stale: false,
};

it.live('a planned transition stamps the thread with its context reading and clears it again, one program each', () =>
  Effect.gen(function* () {
    const { readingStep, storedReading } = yield* opened;
    const set = yield* rootCost('test.transition', readingStep(READING), 'test-reading-set');
    const held = yield* storedReading;
    const cleared = yield* rootCost('test.transition', readingStep(null), 'test-reading-clear');
    const ledger = yield* CostLedger;
    const costs = ['test-reading-set', 'test-reading-clear'].map((rootId) => {
      const total = ledger.read({ rootId, limit: 1 }).rows[0]?.total;
      return { programs: total?.programs, units: total?.units };
    });
    expect({ set, cleared, held, after: yield* storedReading }).toEqual({
      set: { committed: 'applied' },
      cleared: { committed: 'applied' },
      held: { kind: 'text', value: READING },
      after: { kind: 'null', value: null },
    });
    expect(costs).toEqual([
      { programs: 1, units: 0 },
      { programs: 1, units: 0 },
    ]);
  }).pipe(Effect.provide(Layer.fresh(costLedgerLayer({ capacity: 16 })))),
);

const reading = writes('test.metadata', [threadTable()]);

const bare = Effect.gen(function* () {
  const { storage, db, context, units } = yield* openThreadStore();
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
  const metadata = yield* threadMetadata(storage.kinds).pipe(Effect.provide(context));
  return { db, units, metadata, thread };
});

it.live('a program guarded on a thread row it read commits while the row stands and while it is still absent', () =>
  Effect.gen(function* () {
    const { units, metadata, thread } = yield* bare;
    const guarded = (id: string) =>
      units.program(reading, `test:metadata:${id}`, (program) =>
        Effect.map(metadata.metadata(id, programWriteUnit(program)), (row) => row?.id ?? null),
      );
    expect({ standing: yield* guarded(thread.id), absent: yield* guarded('no-such-thread') }).toEqual({
      standing: thread.id,
      absent: null,
    });
  }),
);

it.live('a program whose thread changed its transport after the read is refused at commit', () =>
  Effect.gen(function* () {
    const { units, metadata, db, thread } = yield* bare;
    const outcome = yield* Effect.exit(
      units.program(reading, 'test:metadata:moved', (program) =>
        Effect.gen(function* () {
          const row = yield* metadata.metadata(thread.id, programWriteUnit(program));
          yield* Effect.orDie(
            db.run(sql`update native_thread set transport = json_set(transport, '$.adapter', 'elsewhere') where id = ${thread.id}`),
          );
          return row?.transport.adapter;
        }),
      ),
    );
    const refusal = Exit.isFailure(outcome) ? Cause.squash(outcome.cause) : null;
    expect(refusal).toBeInstanceOf(ProgramConflict);
    const { statement, expected, actual } = refusal as ProgramConflict;
    expect({ statement, expected, actual }).toEqual({ statement: 0, expected: 1, actual: 0 });
  }),
);
