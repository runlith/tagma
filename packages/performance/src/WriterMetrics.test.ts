import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { CostLedger, costLedgerLayer, CurrentCost, producerCost } from './CostLedger.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { PerformanceStoreReader } from './store/store.js';
import { WriterMetrics, makeWriterMetrics } from './WriterMetrics.js';

it.effect('physical unit history retains cause identity while operation histograms keep every observation beyond row eviction', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    const writers = makeWriterMetrics({ units: 2, operations: 2 });
    const cause = ledger.open('act', 'root');
    const origin = writers.units({ limit: 2 }).cursor;
    const first = yield* producerCost(
      'publication',
      Effect.sync(() => writers.begin('write', 'db')),
    ).pipe(Effect.provideService(CurrentCost, cause));
    first.acquired = true;
    first.waitMs = 1;
    first.holdMs = 2.5;
    first.childMs = 0.5;
    first.commitReturnedAt = 1000;
    first.writerPid = 123;
    writers.end(first, 'success');
    const interrupted = writers.begin('write', 'db');
    interrupted.waitMs = 20;
    writers.end(interrupted, 'interrupted');
    const baseline = writers.metrics({ limit: 2 });
    const incomplete = writers.begin('write', 'db');
    incomplete.acquired = true;
    incomplete.waitMs = 5;
    incomplete.holdMs = 5;
    incomplete.childMs = 1;
    incomplete.repliesComplete = false;
    writers.end(incomplete, 'failure');
    const rows = writers.units({ after: origin, limit: 2 });
    expect(rows.gap).toBe(true);
    expect(rows.evicted).toBe(1);
    expect(rows.rows.map((row) => [row.outcome, row.acquired, row.childMs, row.outsideMs, row.commitReturnedAt])).toEqual([
      ['interrupted', false, 0, 0, null],
      ['failure', true, null, null, null],
    ]);
    const after = writers.metrics({ limit: 2 });
    const measured = after.rows[0]!;
    expect(measured.count).toBe(3);
    expect([measured.failures, measured.interruptions, measured.incomplete]).toEqual([1, 1, 1]);
    expect(measured.wait.p50).toEqual({ upperBoundMs: 5 });
    expect(measured.wait.p99).toEqual({ upperBoundMs: 20 });
    expect(measured.hold.p50).toEqual({ upperBoundMs: 3 });
    expect(measured.hold.p99).toEqual({ upperBoundMs: 5 });
    expect([measured.child.count, measured.outside.count]).toEqual([2, 2]);
    expect(after.writerId).toBe(baseline.writerId);
    expect(measured.series).toBe(baseline.rows[0]!.series);
    expect(measured.wait.count - baseline.rows[0]!.wait.count).toBe(1);
    expect(measured.wait.bucketCounts.reduce((sum, count, index) => sum + count - baseline.rows[0]!.wait.bucketCounts[index]!, 0)).toBe(1);
    const kept = writers.begin('publication', 'db');
    writers.end(kept, 'success');
    const current = yield* producerCost(
      'publication',
      Effect.sync(() => writers.begin('publication', 'db')),
    ).pipe(Effect.provideService(CurrentCost, cause));
    writers.end(current, 'success');
    expect(writers.units({ rootId: 'root', operation: 'publication', limit: 2 }).rows[0]!.rootId).toBe('root');
  }),
);

it.effect('operation eviction starts a new histogram series and foreign cursors reset instead of skipping new-process observations', () =>
  Effect.gen(function* () {
    const writers = makeWriterMetrics({ units: 2, operations: 1 });
    writers.end(writers.begin('one', 'db'), 'success');
    const old = writers.metrics({ limit: 1 });
    writers.end(writers.begin('two', 'db'), 'success');
    writers.end(writers.begin('one', 'db'), 'success');
    const measured = writers.metrics({ operation: 'one', limit: 1 });
    expect(measured.evictedOperations).toBe(2);
    expect(measured.rows[0]!.count).toBe(1);
    expect(measured.rows[0]!.series).toBeGreaterThan(old.rows[0]!.series);
    const replacement = makeWriterMetrics({ units: 2, operations: 1 });
    replacement.end(replacement.begin('fresh', 'db'), 'success');
    const page = replacement.units({ after: writers.units({ limit: 2 }).cursor, limit: 1 });
    expect(page.reset).toBe(true);
    expect(page.gap).toBe(false);
    expect(page.rows[0]!.operation).toBe('fresh');
    const metrics = replacement.metrics({ after: { writerId: measured.writerId, series: measured.rows[0]!.series }, limit: 1 });
    expect(metrics.reset).toBe(true);
    expect(metrics.rows[0]!.operation).toBe('fresh');
  }),
);

it.effect('public performance reports expose in-process unit rows and histogram precision without reading the durable store', () =>
  Effect.gen(function* () {
    const writers = makeWriterMetrics({ units: 2, operations: 1 });
    const frame = writers.begin('write', 'db');
    frame.acquired = true;
    frame.holdMs = 5;
    frame.childMs = 1;
    frame.commitReturnedAt = 1000;
    writers.end(frame, 'success');
    const reports = yield* PerformanceReports.pipe(
      Effect.provide(
        performanceReportsLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(WriterMetrics, writers),
              Layer.succeed(
                PerformanceStoreReader,
                PerformanceStoreReader.of({ read: () => Effect.die('writer reports are process-local') }),
              ),
            ),
          ),
        ),
      ),
    );
    const units = yield* reports.read({ type: 'writer-units', operation: 'write', limit: 1 });
    expect(units.type).toBe('writer-units');
    if (units.type === 'writer-units')
      expect(units.rows[0]).toMatchObject({ operation: 'write', commitReturnedAt: 1000, childMs: 1, outsideMs: 4 });
    const metrics = yield* reports.read({ type: 'writer-metrics', operation: 'write', limit: 1 });
    expect(metrics.type).toBe('writer-metrics');
    if (metrics.type === 'writer-metrics') {
      expect(metrics.boundariesMs).toContain(5);
      expect(metrics.rows[0]!.hold.p99).toEqual({ upperBoundMs: 5 });
    }
  }),
);
