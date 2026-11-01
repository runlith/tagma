import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '@runlith/agent/thread/storage/runs';
import { nativeRows, thread } from '../../threads/store/kernel.js';
import { conversationWrites } from '../../threads/store/journal.js';
import { SCOPED_RUN } from '../row.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { threadStack } from '../../composition/testing/threadParts.js';
import { stallSighting } from './stalls.js';
import { threadSelectionOf } from '../../threads/list/wire.js';
import { CORE_KINDS, threadRunStore } from '../testing/doubles.js';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { writes } from '../../platform/contract/service/writes.js';
import { sqliteThreadJournal, threadEvent } from '../../threads/testing/doubles.js';

const MINUTE = 60_000;

layer(demoGraphLayer(), { excludeTestServices: true })('run stalls', (it) => {
  it.effect(
    'a run parked past the widest gap is selected and named once per stall while its heartbeat keeps beating; a run asking and a healthy one are not',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const db = demo.graph.store.db;
          const records = yield* makeThreadRecords;
          const { store, threads } = yield* threadStack({ db, units: demo.graph.units, records, kinds: CORE_KINDS });
          const runs = yield* threadRunStore({ kinds: CORE_KINDS, records, ownerId: 'instance', scope: SCOPED_RUN });
          const born = yield* demo.graph.units
            .write('StallSighting.born', (unit) =>
              Effect.gen(function* () {
                const made: Record<string, string> = {};
                for (const name of ['parked', 'asking', 'healthy', 'resting']) {
                  const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
                  yield* threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId }, unit);
                  made[name] = row.id;
                }
                return made as Record<'parked' | 'asking' | 'healthy' | 'resting', string>;
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
                progress: { stage: 'starting', message: null },
              })
              .pipe(
                Effect.map((started) => started.run),
                Effect.orDie,
              );
          const parked = yield* start(born.parked);
          const asking = yield* start(born.asking);
          yield* start(born.healthy);
          const now = yield* Clock.currentTimeMillis;
          yield* runs
            .writeProgress(asking.id, { stage: THREAD_RUN_AWAITING_QUESTION_STAGE, message: null }, new Date(now))
            .pipe(Effect.orDie);
          const moved = (threadId: string, at: Date) =>
            db.update(thread).set({ updatedAt: at }).where(eq(thread.id, threadId)).pipe(Effect.orDie);
          const parkedAt = new Date(now - 99 * MINUTE);
          yield* moved(born.parked, parkedAt);
          yield* moved(born.asking, parkedAt);
          yield* moved(born.resting, parkedAt);
          yield* moved(born.healthy, new Date(now - 9 * MINUTE));
          yield* runs.writeHeartbeats([parked.id], new Date(now)).pipe(Effect.orDie);
          const selected = Effect.fnUntraced(function* (state: string) {
            const selection = yield* threadSelectionOf({ state });
            const page = yield* threads.list
              .list('operator', { id: demo.projectId, projects: [demo.projectId] }, selection)
              .pipe(Effect.orDie);
            return page.rows.map((row) => row.id).sort();
          });
          const selection = yield* threadSelectionOf({ state: 'running' });
          const page = yield* threads.list
            .list('operator', { id: demo.projectId, projects: [demo.projectId] }, selection)
            .pipe(Effect.orDie);
          const read = new Map(page.rows.map((row) => [row.id, row.life]));
          expect([read.get(born.parked), read.get(born.asking), read.get(born.healthy)]).toEqual(['stalled', 'awaiting', 'working']);
          expect(yield* selected('stalled')).toEqual([born.parked]);
          expect(yield* selected('running')).toEqual([born.parked, born.asking, born.healthy].sort());
          const sighting = stallSighting(threads.rows);
          const pass = sighting.pass().pipe(Effect.orDie);
          expect(yield* pass).toEqual([{ threadId: born.parked, projectId: demo.projectId, runId: parked.id, movedAt: parkedAt }]);
          yield* runs.writeHeartbeats([parked.id], new Date(now + 5_000)).pipe(Effect.orDie);
          expect(yield* pass).toEqual([]);
          const movedAgain = new Date(now - 30 * MINUTE);
          yield* moved(born.parked, movedAgain);
          expect(yield* pass).toEqual([{ threadId: born.parked, projectId: demo.projectId, runId: parked.id, movedAt: movedAgain }]);
        }),
      ),
  );

  it.effect('a stall is judged by the thread’s own call envelope, and a durable report moves its clock', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const db = demo.graph.store.db;
        const records = yield* makeThreadRecords;
        const { store, threads } = yield* threadStack({ db, units: demo.graph.units, records, kinds: CORE_KINDS });
        const runs = yield* threadRunStore({ kinds: CORE_KINDS, records, ownerId: 'instance', scope: SCOPED_RUN });
        const seats = { watched: [10 * MINUTE, 30 * MINUTE], short: [MINUTE, 5 * MINUTE], unjudged: [null, 30 * MINUTE] } as const;
        const made: Record<string, string> = {};
        for (const [name, [callEnvelopeMs, quietMs]] of Object.entries(seats)) {
          const row = yield* demo.graph.units
            .write('StallEnvelope.born', (unit) =>
              Effect.gen(function* () {
                const born = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
                yield* threads.rows.attachFacet({ threadId: born.id, projectId: demo.projectId }, unit);
                return born;
              }),
            )
            .pipe(Effect.orDie);
          made[name] = row.id;
          yield* runs
            .createRun({
              startFrom: {
                id: row.id,
                ownerId: 'operator',
                account: null,
                provider: 'openai-oauth',
                model: 'test',
                reasoning: null,
                switches: {},
              },
              kind: 'turn',
              approval: { mode: 'trust', interactive: false },
              progress: { stage: 'starting', message: null },
            })
            .pipe(Effect.orDie);
          yield* db
            .update(thread)
            .set({
              capabilities: { ...NATIVE_CAPABILITIES, callEnvelopeMs },
              updatedAt: new Date((yield* Clock.currentTimeMillis) - quietMs),
            })
            .where(eq(thread.id, row.id))
            .pipe(Effect.orDie);
        }
        const stalled = Effect.gen(function* () {
          const selection = yield* threadSelectionOf({ state: 'stalled' });
          const page = yield* threads.list
            .list('operator', { id: demo.projectId, projects: [demo.projectId] }, selection)
            .pipe(Effect.orDie);
          return page.rows.map((row) => row.id);
        });
        expect(yield* stalled).toEqual([made.watched!]);
        const journal = yield* sqliteThreadJournal();
        yield* demo.graph.units
          .write(writes('StallEnvelope.report', [threadEvent(), nativeRows], conversationWrites), (unit) =>
            journal.append(
              {
                threadId: made.watched!,
                id: 'report-1',
                kind: 'message',
                payload: { entry: { type: 'message', id: 'report-1', role: 'user', text: 'x' } },
              },
              unit,
            ),
          )
          .pipe(Effect.orDie);
        expect(yield* stalled).toEqual([]);
      }),
    ),
  );
});
