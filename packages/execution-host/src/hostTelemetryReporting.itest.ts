import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Exit, FileSystem, Layer, Metric, Path } from 'effect';
import { PerformanceReports, performanceReportsLayer } from '@runlith/performance/PerformanceReports';
import { PerformanceStore, performanceStoreLayer } from '@runlith/performance/PerformanceStore';
import * as PerformanceTracer from '@runlith/performance/PerformanceTracer';
import { countRefusal, fiberDeaths, hostSpan, refusals, reportDeadFiber } from './hostTelemetry';
import { hostTestRoot } from './hostFixture';

const platform = Layer.mergeAll(
  BunFileSystem.layer,
  BunPath.layer,
  Layer.sync(Metric.MetricRegistry, () => new Map()),
);

layer(platform, { excludeTestServices: true })('host telemetry reporting', (it) => {
  it.effect(
    'a refusal increments its own series and no other',
    Effect.fnUntraced(function* () {
      yield* countRefusal('CapacityExceeded');
      yield* countRefusal('CapacityExceeded');
      const refused = yield* Metric.value(Metric.withAttributes(refusals, { refusal: 'CapacityExceeded' }));
      const other = yield* Metric.value(Metric.withAttributes(refusals, { refusal: 'Unauthorized' }));
      expect(refused.count).toBe(2);
      expect(other.count).toBe(0);
    }),
  );

  it.effect(
    'a dead fiber is counted under its name and the defect still kills',
    Effect.fnUntraced(function* () {
      const exit = yield* Effect.exit(reportDeadFiber('test-death', Effect.die(new Error('boom'))));
      const deaths = yield* Metric.value(Metric.withAttributes(fiberDeaths, { fiber: 'test-death' }));
      const foreign = yield* Metric.value(Metric.withAttributes(fiberDeaths, { fiber: 'someone-else' }));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(deaths.count).toBe(1);
      expect(foreign.count).toBe(0);
    }),
  );

  it.effect(
    'the identity a host span attaches survives the exporter that projects it',
    Effect.fnUntraced(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = hostTestRoot();
      yield* fs.makeDirectory(root, { recursive: true });
      const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'span-projection-' });
      const page = yield* PerformanceStore.use((store) =>
        Effect.gen(function* () {
          const reports = yield* PerformanceReports;
          const tracer = yield* PerformanceTracer.make({ instanceId: 'host', recordFloorMicros: 0, keepOneTraceIn: () => 1 });
          yield* hostSpan(
            'Stop',
            {
              incarnation: 0,
              role: 'custodian',
              connectionId: '0:1ba8ba52',
              executionId: 'eef823b0',
              operationId: 'telemetry-stop',
            },
            Effect.void,
          ).pipe(Effect.withTracer(tracer));
          yield* store.flush;
          return yield* reports.read({ type: 'slow', name: 'Host.Stop', limit: 10 });
        }),
      ).pipe(
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
      const span = page.spans.find((record) => record.name === 'Host.Stop');
      expect(span?.payload).toMatchObject({
        attributes: {
          'execution.id': 'eef823b0',
          'host.incarnation': 0,
          'host.operation.id': 'telemetry-stop',
          'host.role': 'custodian',
          'host.connection.id': '0:1ba8ba52',
        },
      });
    }),
  );
});
