import { expect } from 'bun:test';
import { it, layer } from '@runlith/effect-test';
import { CostLedger, costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { APPROVAL, lifecycleWorld, started } from '@runlith/agent/thread/conformance/lifecycleWorld';
import type { ThreadStateChange } from '@runlith/agent/thread/state';
import { openThreadStore } from '../../composition/testing/storageHarness.js';
import { eq, sql } from 'drizzle-orm';
import { Clock, Effect, Layer, Tracer } from 'effect';
import { SCOPED_RUN } from '../row.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { threadStack } from '../../composition/testing/threadParts.js';
import { CORE_KINDS, threadRunStore } from '../testing/doubles.js';
import { threadRun } from '../../threads/store/kernel.js';

it.live('a beat commits as one program and answers its owner’s stop requests and thread revision', () =>
  Effect.gen(function* () {
    const { storage } = yield* openThreadStore();
    const world = yield* lifecycleWorld(() => Effect.succeed(storage));
    const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
    const at = new Date((yield* Clock.currentTimeMillis) + 60_000);
    yield* world.runs.requestStop(run.id, { by: 'reader', marker: false, withdraw: false }, at);
    const before = yield* storage.transitions.revision(run.threadId);
    const handed: ThreadStateChange[] = [];
    world.changes.project((change) => Effect.sync(() => void handed.push(change)));
    const asked = yield* rootCost('test.beat', world.lifecycle.beat([run], at), 'test-beat');
    const [cost] = (yield* CostLedger).read({ rootId: 'test-beat', limit: 1 }).rows;
    expect({ programs: cost?.total.programs, units: cost?.total.units }).toEqual({ programs: 1, units: 0 });
    expect(asked).toEqual([{ runId: run.id, by: 'reader' }]);
    expect(yield* world.runs.runById(run.id)).toMatchObject({ heartbeatAt: at, updatedAt: at });
    const after = yield* storage.transitions.revision(run.threadId);
    expect(after).toBeGreaterThan(before);
    expect(handed).toEqual([
      {
        kind: 'ran',
        threadId: run.threadId,
        revision: { from: before, to: after },
        runs: [{ id: run.id, heartbeatAt: at, updatedAt: at }],
      },
    ]);
  }).pipe(Effect.provide(Layer.fresh(costLedgerLayer({ capacity: 16 })))),
);

const MINUTE = 60_000;

const statements = <A>(work: Effect.Effect<A, unknown>) =>
  Effect.suspend(() => {
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    return Effect.map(work.pipe(Effect.withTracer(tracer)), (value) => ({
      value,
      count: spans.filter((span) => span.name === 'sql.execute').length,
    }));
  });

layer(demoGraphLayer(), { excludeTestServices: true })('run heartbeat', (it) => {
  it.effect(
    'a beat of the going runs and the search for abandoned runs cost the same however many threads idle beside them, and touch only the going runs and their threads’ change revisions',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const db = demo.graph.store.db;
          const records = yield* makeThreadRecords;
          const { store, threads } = yield* threadStack({ db, units: demo.graph.units, records, kinds: CORE_KINDS });
          const runs = yield* threadRunStore({ kinds: CORE_KINDS, records, ownerId: 'instance', scope: SCOPED_RUN });
          const born = (count: number) =>
            demo.graph.units
              .write('beat.born', (unit) =>
                Effect.gen(function* () {
                  const ids: string[] = [];
                  for (let index = 0; index < count; index += 1) {
                    const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
                    yield* threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId }, unit);
                    ids.push(row.id);
                  }
                  return ids;
                }),
              )
              .pipe(Effect.orDie);
          const start = (threadId: string) =>
            runs
              .createRun({
                startFrom: {
                  id: threadId,
                  ownerId: 'operator',
                  account: null,
                  provider: 'openai-oauth',
                  model: 'test',
                  reasoning: null,
                  switches: {},
                },
                kind: 'turn',
                approval: { mode: 'trust', interactive: false },
                progress: { stage: 'running', message: null },
              })
              .pipe(
                Effect.map((started) => started.run),
                Effect.orDie,
              );
          const heartbeatOf = (runId: string) =>
            Effect.map(
              db.select({ at: threadRun.heartbeatAt }).from(threadRun).where(eq(threadRun.id, runId)).get().pipe(Effect.orDie),
              (row) => row?.at.getTime() ?? null,
            );
          const going = [yield* start((yield* born(1))[0]!), yield* start((yield* born(1))[0]!)];
          yield* born(2);
          const totalChanges = Effect.map(db.all<{ n: number }>(sql`select total_changes() as n`).pipe(Effect.orDie), (rows) => rows[0]!.n);
          const written = Effect.fnUntraced(function* <A>(work: Effect.Effect<A, unknown>) {
            const before = yield* totalChanges;
            const measured = yield* statements(work);
            return { ...measured, rows: (yield* totalChanges) - before };
          });
          const measure = Effect.gen(function* () {
            const before = yield* Effect.all(
              going.map((run) => heartbeatOf(run.id)),
              { concurrency: 2 },
            );
            const beaten = new Date((yield* Clock.currentTimeMillis) + 5 * MINUTE);
            const beat = yield* written(
              runs.writeHeartbeats(
                going.map((run) => run.id),
                beaten,
              ),
            );
            const after = yield* Effect.all(
              going.map((run) => heartbeatOf(run.id)),
              { concurrency: 2 },
            );
            const search = yield* written(runs.reapableRuns({ kind: 'stale-heartbeat', heartbeatBefore: new Date(beaten.getTime() + 1) }));
            const changed = after.flatMap((at, index) => (at !== before[index] ? [String(index)] : []));
            return {
              beat: beat.count,
              beatRows: beat.rows,
              search: search.count,
              searchRows: search.rows,
              found: search.value.map((row) => row.id).sort(),
              changed,
            };
          });
          const few = yield* measure;
          yield* born(12);
          const many = yield* measure;
          expect(few.changed).toEqual(['0', '1']);
          expect(many.changed).toEqual(['0', '1']);
          expect(few.beatRows).toBe(2 * going.length);
          expect(many.beatRows).toBe(few.beatRows);
          expect(few.searchRows).toBe(0);
          expect(many.searchRows).toBe(0);
          expect(many.beat).toBe(few.beat);
          expect(many.search).toBe(few.search);
          expect(many.found).toEqual(few.found);
          expect(few.found).toEqual(going.map((run) => run.id).sort());
        }),
      ),
  );
});
