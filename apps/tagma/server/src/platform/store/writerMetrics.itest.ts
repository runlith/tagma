import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { CostLedger, costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { WriterMetrics, writerMetricsLayer } from '@runlith/performance/WriterMetrics';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../contract/service/store.js';
import { seededStoreLayer } from './open.js';

layer(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)), { excludeTestServices: true })(
  'physical writer metrics',
  (it) => {
    it.effect(
      'unsampled outer units expose writer COMMIT metadata before tails and keep failures, interruptions and nested joins distinct',
      () =>
        Effect.gen(function* () {
          const store = yield* MachineStore;
          const writers = yield* WriterMetrics.pipe(Effect.provide(writerMetricsLayer({ units: 8, operations: 8 })));
          const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
          yield* rootCost(
            'probe',
            Effect.gen(function* () {
              const published = yield* Deferred.make<void>();
              const release = yield* Deferred.make<void>();
              const writing = yield* Effect.forkChild(
                store.transaction('outer', () => store.transaction('nested', () => store.db.all(sql`select 1 as value`)), {
                  onCommit: () => Effect.andThen(Deferred.succeed(published, undefined), Deferred.await(release)),
                }),
              );
              yield* Deferred.await(published);
              const beforeTail = writers.units({ rootId: 'unit-root', limit: 8 });
              expect(beforeTail.rows).toHaveLength(1);
              const committed = beforeTail.rows[0]!;
              expect(committed).toMatchObject({ operation: 'outer', outcome: 'success', acquired: true });
              expect(committed.commitReturnedAt).toBeGreaterThan(0);
              expect(committed.writerPid).toBeGreaterThan(0);
              expect(committed.holdMs).toBeGreaterThan(0);
              expect(committed.childMs).toBeGreaterThanOrEqual(0);
              expect(committed.outsideMs).toBeGreaterThanOrEqual(0);
              expect(committed.childMs! + committed.outsideMs!).toBe(committed.holdMs);
              yield* Deferred.succeed(release, undefined);
              yield* Fiber.join(writing);
              expect(writers.units({ rootId: 'unit-root', limit: 8 }).rows[0]!.holdMs).toBe(committed.holdMs);
              const failed = yield* Effect.result(
                store.transaction('rollback', () => Effect.andThen(store.db.all(sql`select 2 as value`), Effect.fail('rolled back'))),
              );
              expect(failed).toMatchObject({ _tag: 'Failure', failure: 'rolled back' });
              const entered = yield* Deferred.make<void>();
              const interrupted = yield* Effect.forkChild(
                store.transaction('interrupted', () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)),
              );
              yield* Deferred.await(entered);
              yield* Fiber.interrupt(interrupted);
              const rows = writers.units({ rootId: 'unit-root', limit: 8 }).rows;
              expect(rows.map((row) => [row.operation, row.outcome])).toEqual([
                ['outer', 'success'],
                ['rollback', 'failure'],
                ['interrupted', 'interrupted'],
              ]);
              for (const row of rows.slice(1)) {
                expect(row.acquired).toBe(true);
                expect(row.commitReturnedAt).toBeNull();
                expect(row.holdMs).toBeGreaterThan(0);
                expect(row.childMs).toBeGreaterThanOrEqual(0);
              }
              expect(writers.metrics({ operation: 'outer', limit: 1 }).rows[0]!.count).toBe(1);
              expect(writers.metrics({ operation: 'nested', limit: 1 }).rows).toEqual([]);
            }),
            'unit-root',
          ).pipe(Effect.provideService(CostLedger, ledger), Effect.provideService(WriterMetrics, writers), Effect.withTracerEnabled(false));
        }),
    );
  },
);
