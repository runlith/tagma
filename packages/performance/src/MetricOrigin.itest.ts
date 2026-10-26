import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { join } from 'node:path';
import * as MetricSnapshots from './MetricSnapshots.js';
import * as PerformanceTracer from './PerformanceTracer.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { scratchDirectory } from './testing/scratchDirectory.js';

it.live('a name first seen at the final snapshot retains its completed work and an unsampled interval explains its silence', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-metric-origin-');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const observed = PerformanceTracer.layer({ instanceId: 'process', recordFloorMicros: 0 }).pipe(
        Layer.provideMerge(MetricSnapshots.layer({ instanceId: 'process', intervalMs: () => 3_600_000 })),
      );
      yield* Effect.void.pipe(Effect.withSpan('completed-before-first-tick'), Effect.provide(observed));
      yield* store.flush;
      const metrics = yield* reports.read({ type: 'metrics', name: 'completed-before-first-tick', limit: 1 });
      const overview = yield* reports.read({ type: 'overview', since: 0, until: 1, limit: 1 });
      if (metrics.type !== 'metrics' || overview.type !== 'overview') return yield* Effect.die('unexpected report');
      expect(metrics.hours[0]?.count).toBe(1);
      expect(overview.observed).toBeNull();
      expect(overview.series).toEqual([]);
      expect(overview).toHaveProperty('coverageReason', 'no-snapshots-in-interval');
    }).pipe(
      Effect.provide(
        performanceReportsLayer.pipe(
          Layer.provideMerge(
            performanceStoreLayer({
              path: join(directory, 'performance.sqlite'),
              instanceId: 'process',
              maxPendingBytes: () => 1_000_000,
              maxStoredBytes: () => 1_000_000,
            }),
          ),
        ),
      ),
    );
  }),
);
