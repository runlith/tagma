import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { CostLedger, costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { readThreadEvents, threadEntryEvent, threadStepMessagesEvent } from '@runlith/agent/thread/events';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import type { ThreadChangeRevision } from '@runlith/agent/thread/state';
import { callKey, type Evidence, REPORT_OPERATION, REPORT_WINDOW, reportKey } from '@runlith/agent/thread/keyed';
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
  const { storage, db, units } = yield* openThreadStore();
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
  const runs = storage.runs({ ownerId: OWNER, scope: SCOPE });
  const starting = () =>
    runs.createRun({
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
  const start = yield* starting();
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
  const absentStep = () =>
    transitionNow(
      deps,
      thread.id,
      {
        declared: sealThreadEvents([threadStepMessagesEvent([Message.assistant('absent')])!]),
        decide: Effect.fnUntraced(function* (_view: unknown, tx: WriteUnit<'machine'>) {
          const standing = yield* runs.latestRun(thread.id, ['running'], tx);
          return standing === null ? { apply: true as const, result: 'applied' } : { refuse: 'refused' };
        }),
      },
      { evidence: { decidedBy: 'test:absent' }, digest: 'absent' },
    );
  const settled = Effect.gen(function* () {
    const at = new Date(yield* Clock.currentTimeMillis);
    return yield* runs.settleRun(start.run.id, {
      status: 'completed',
      progress: { stage: 'completed', message: null },
      finishedAt: at,
      heartbeatAt: at,
    });
  });
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
  return {
    storage,
    db,
    thread,
    units,
    runs,
    starting,
    run: start.run,
    settled,
    absentStep,
    step,
    entryStep,
    readingStep,
    storedReading,
    cursor,
    journal,
    deps,
  };
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

it.live('a decision that found no running run commits as one program while none has started', () =>
  Effect.gen(function* () {
    const { storage, thread, settled, absentStep } = yield* opened;
    yield* settled;
    const outcome = yield* rootCost('test.transition', absentStep(), 'test-absent');
    const [row] = (yield* CostLedger).read({ rootId: 'test-absent', limit: 1 }).rows;
    expect(outcome).toEqual({ committed: 'applied' });
    expect({ programs: row?.total.programs, units: row?.total.units }).toEqual({ programs: 1, units: 0 });
    expect((yield* storage.aggregate.historyOf(thread.id))?.map((message) => message.role)).toEqual(['assistant']);
  }).pipe(Effect.provide(Layer.fresh(costLedgerLayer({ capacity: 16 })))),
);

it.live('a program that read no running run is refused at commit once a run has started', () =>
  Effect.gen(function* () {
    const { units, runs, thread, starting, settled } = yield* opened;
    yield* settled;
    const read = yield* Deferred.make<void>();
    const written = yield* Deferred.make<void>();
    const writer = yield* Effect.forkChild(
      Effect.andThen(Deferred.await(read), Effect.ensuring(starting(), Deferred.succeed(written, undefined))),
    );
    const outcome = yield* Effect.exit(
      units.program(reading, 'test:run:absent', (program) =>
        Effect.gen(function* () {
          const standing = yield* runs.latestRun(thread.id, ['running'], programWriteUnit(program));
          yield* Deferred.succeed(read, undefined);
          yield* Deferred.await(written);
          return standing;
        }),
      ),
    );
    yield* Fiber.join(writer);
    const refusal = Exit.isFailure(outcome) ? Cause.squash(outcome.cause) : null;
    expect(refusal).toBeInstanceOf(ProgramConflict);
    const { statement, expected, actual } = refusal as ProgramConflict;
    expect({ statement, expected, actual }).toEqual({ statement: 0, expected: 1, actual: 0 });
  }),
);

it.live('a program that read a run by id commits while that run stands and is refused once it moved', () =>
  Effect.gen(function* () {
    const { thread, run, runs, db, deps } = yield* opened;
    const reading = (decidedBy: string, moved?: () => Effect.Effect<void, unknown>) =>
      transitionNow(
        deps,
        thread.id,
        {
          declared: sealThreadEvents([threadStepMessagesEvent([Message.assistant(decidedBy)])!]),
          decide: Effect.fnUntraced(function* (_view: unknown, tx: WriteUnit<'machine'>) {
            const standing = yield* runs.runById(run.id, tx);
            if (moved !== undefined) yield* Effect.orDie(moved());
            return standing?.ownerId === OWNER ? { apply: true as const, result: 'applied' } : { refuse: 'refused' };
          }),
        },
        { evidence: { decidedBy: `test:${decidedBy}` }, digest: decidedBy },
      );
    const standing = yield* rootCost('test.transition', reading('standing'), 'test-by-id');
    const [row] = (yield* CostLedger).read({ rootId: 'test-by-id', limit: 1 }).rows;
    let moves = 0;
    const moved = yield* reading('moved', () =>
      moves++ === 0 ? db.run(sql`update thread_run set owner_id = 'elsewhere' where id = ${run.id}`) : Effect.void,
    );
    expect({ standing, programs: row?.total.programs, units: row?.total.units, moved }).toEqual({
      standing: { committed: 'applied' },
      programs: 1,
      units: 0,
      moved: { refused: 'refused' },
    });
  }).pipe(Effect.provide(Layer.fresh(costLedgerLayer({ capacity: 16 })))),
);

it.live('planned report calls keep the newest window of their run and trim the older ones', () =>
  Effect.gen(function* () {
    const { db, thread, run, step } = yield* opened;
    yield* db.run(
      sql`with recursive n(i) as (select 0 union all select i + 1 from n where i < ${REPORT_WINDOW - 1})
        insert into thread_call (actor, operation, key, thread_id, digest, result, at)
        select ${run.id}, ${REPORT_OPERATION}, 'm' || i, ${thread.id}, 'seed', '{"answer":null}', 0 from n`,
    );
    const marks = ['m64', 'm65'];
    const outcomes = yield* rootCost(
      'test.transition',
      Effect.forEach(marks, (mark) => step(mark, undefined, { call: reportKey(run.id, mark) })),
      'test-reports',
    );
    const [row] = (yield* CostLedger).read({ rootId: 'test-reports', limit: 1 }).rows;
    const kept = yield* db.all<{ key: string }>(
      sql`select key from thread_call where actor = ${run.id} and operation = ${REPORT_OPERATION} order by rowid`,
    );
    expect({
      applied: outcomes.every((outcome) => 'committed' in outcome),
      programs: row?.total.programs,
      units: row?.total.units,
    }).toEqual({
      applied: true,
      programs: marks.length,
      units: 0,
    });
    expect(kept.map((call) => call.key)).toEqual([...Array.from({ length: REPORT_WINDOW - 2 }, (_, index) => `m${index + 2}`), ...marks]);
  }).pipe(Effect.provide(Layer.fresh(costLedgerLayer({ capacity: 16 })))),
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

it.live('thread revisions opened and revised by a program are named from the committed rows, alone and joined to an open unit', () =>
  Effect.gen(function* () {
    const { storage, thread } = yield* opened;
    const named: ReadonlyMap<string, ThreadChangeRevision>[] = [];
    const bumped = (identity: string) =>
      storage.aggregate.program!(identity, (tx) =>
        Effect.andThen(
          storage.transitions.opened([thread.id], tx),
          storage.transitions.revised([thread.id], tx, (revisions) => Effect.sync(() => void named.push(revisions))),
        ),
      );
    const before = yield* storage.transitions.revision(thread.id);
    yield* bumped('test:revisions:alone');
    yield* storage.aggregate.transaction(() => bumped('test:revisions:joined'));
    expect({ named: named.map((revisions) => revisions.get(thread.id)), now: yield* storage.transitions.revision(thread.id) }).toEqual({
      named: [
        { from: before, to: before + 1 },
        { from: before + 1, to: before + 2 },
      ],
      now: before + 2,
    });
  }),
);
