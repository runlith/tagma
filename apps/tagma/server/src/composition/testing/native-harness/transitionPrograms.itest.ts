import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { CostLedger, costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { readThreadEvents, threadEntryEvent, threadStepMessagesEvent } from '@runlith/agent/thread/events';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { callKey, type Evidence } from '@runlith/agent/thread/keyed';
import { sealThreadEvents } from '@runlith/agent/thread/ThreadEventDoor';
import { type TransitionDeps, transitionNow } from '@runlith/agent/thread/transition/kernel';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import { OWNER, SCOPE } from '@runlith/agent/thread/conformance/runLog/world';
import { openThreadStore } from '../storageHarness.js';

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
  const cursor = Effect.gen(function* () {
    const [log] = yield* db.all<{ through: number; head: number }>(
      sql`select entries_through as through, (select max(position) from thread_event where thread_id = ${thread.id}) as head
        from thread_log where thread_id = ${thread.id}`,
    );
    return log;
  });
  const journal = readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 100);
  return { storage, db, thread, run: start.run, step, entryStep, cursor, journal, deps };
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
