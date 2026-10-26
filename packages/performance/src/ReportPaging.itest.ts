import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { join } from 'node:path';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { recordByteSize, type PerformanceRecord } from './store/records.js';
import { scratchDirectory } from './testing/scratchDirectory.js';

it.live('report pages distinguish a counted population from an uncounted suffix', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-report-paging-');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const keep = (record: PerformanceRecord) => store.submit({ record, retentionKey: record.id, byteSize: recordByteSize(record) });
      for (let index = 0; index < 2; index += 1) {
        keep({
          id: `span-${index}`,
          instanceId: 'process',
          kind: 'span',
          wallTime: index + 1,
          monotonicStart: 0,
          monotonicEnd: index + 1,
          name: 'work',
          traceId: `trace-${index}`,
          parentId: null,
          payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: {} },
        });
        keep({
          id: `metric-${index}`,
          instanceId: 'process',
          kind: 'metric',
          wallTime: index + 1,
          monotonicStart: index + 1,
          monotonicEnd: index + 1,
          name: 'work',
          payload: { boundariesMs: [10], bucketCounts: [index, 0], count: index, failures: 0, sumMs: index, minMs: 0, maxMs: index },
        });
      }
      yield* store.flush;
      const first = yield* reports.read({ type: 'slow', name: 'work', limit: 1 });
      const whole = yield* reports.read({ type: 'slow', name: 'work', limit: 2 });
      const overview = yield* reports.read({ type: 'overview', since: 1, until: 3, limit: 1 });
      if (first.type !== 'slow' || whole.type !== 'slow' || overview.type !== 'overview') return yield* Effect.die('unexpected report');
      expect(first.total).toBeNull();
      expect(first.next).not.toBeNull();
      expect(whole.total).toBe(2);
      expect(whole.spans.map((span) => span.id)).toEqual(['span-1', 'span-0']);
      expect(whole.next).toBeNull();
      expect(overview.total).toBe(1);
      expect(overview.series[0]?.count).toBe(1);
      const next = yield* reports.read({ type: 'slow', name: 'work', limit: 1, after: first.next! });
      if (next.type !== 'slow') return yield* Effect.die('unexpected report');
      expect(next.total).toBeNull();
      expect(next.spans.map((span) => span.id)).toEqual(['span-0']);
      expect(next.next).toBeNull();
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
