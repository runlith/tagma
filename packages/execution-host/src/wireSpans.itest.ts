import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Metric, Path } from 'effect';
import { PerformanceReports, performanceReportsLayer } from '@runlith/performance/PerformanceReports';
import { PerformanceStore, performanceStoreLayer } from '@runlith/performance/PerformanceStore';
import * as PerformanceTracer from '@runlith/performance/PerformanceTracer';
import { hostTestRoot } from './hostFixture';

it.live(
  'the figures a wire span attaches survive the exporter that projects them',
  Effect.fnUntraced(
    function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = hostTestRoot();
      yield* fs.makeDirectory(root, { recursive: true });
      const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'wire-projection-' });
      const page = yield* PerformanceStore.use((store) =>
        Effect.gen(function* () {
          const reports = yield* PerformanceReports;
          const tracer = yield* PerformanceTracer.make({
            instanceId: 'host',
            recordFloorMicros: 0,
            keepOneTraceIn: () => 1,
          });
          yield* Effect.withSpan(Effect.void, 'wire.request.slot', {
            attributes: { lane: 'control', depth: 3, kind: 'Call', cells: 42 },
          }).pipe(Effect.withTracer(tracer));
          yield* store.flush;
          return yield* reports.read({ type: 'slow', name: 'wire.request.slot', limit: 10 });
        }),
      ).pipe(
        Effect.provideService(Metric.MetricRegistry, new Map()),
        Effect.provide(performanceReportsLayer),
        Effect.provide(
          performanceStoreLayer({
            path: path.join(directory, 'performance.sqlite'),
            instanceId: 'host',
            maxStoredBytes: () => 64 * 1024 * 1024,
            maxPendingBytes: () => 8 * 1024 * 1024,
          }),
        ),
      );
      expect(page.type).toBe('slow');
      if (page.type !== 'slow') return;
      const span = page.spans.find((record) => record.name === 'wire.request.slot');
      expect(span?.payload).toMatchObject({
        attributes: {
          'wire.lane': 'control',
          'wire.depth': 3,
          'wire.kind': 'Call',
          'presentation.cells': 42,
        },
      });
    },
    Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
  ),
);
