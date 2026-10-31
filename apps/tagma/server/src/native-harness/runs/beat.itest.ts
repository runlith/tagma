import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq, sql } from 'drizzle-orm';
import { Clock, Effect, Tracer } from 'effect';
import { SCOPED_RUN } from '../row.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { threadStack } from '../../composition/testing/threadParts.js';
import { CORE_KINDS, threadRunStore } from '../testing/doubles.js';
import { threadRun } from '../../threads/store/kernel.js';

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
