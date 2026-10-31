import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { CostLedger, costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { threadStepMessagesEvent } from '@runlith/agent/thread/events';
import { sealThreadEvents } from '@runlith/agent/thread/ThreadEventDoor';
import { type TransitionDeps, transitionNow } from '@runlith/agent/thread/transition/kernel';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import { OWNER, SCOPE } from '@runlith/agent/thread/conformance/runLog/world';
import { openThreadStore } from '../storageHarness.js';

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
  const step = (decidedBy: string, moved?: () => Effect.Effect<void, unknown>) =>
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
      { evidence: { decidedBy: `test:${decidedBy}` }, digest: decidedBy },
    );
  return { storage, db, thread, run: start.run, step };
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
