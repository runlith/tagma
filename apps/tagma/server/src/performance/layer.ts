import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect, Layer } from 'effect';
import { costLedgerLayer } from '@runlith/performance/CostLedger';
import { WriterMetrics } from '@runlith/performance/WriterMetrics';
import { MachineStore } from '../platform/contract/service/store.js';
import { cpuProfilesLayer } from '@runlith/performance/CpuProfiles';
import { cpuProfilerLayer } from '@runlith/performance/CpuProfiler';
import { heapSnapshotsLayer } from '@runlith/performance/HeapSnapshots';
import * as LoopStalls from '@runlith/performance/LoopStalls';
import { memoryCapturesLayer } from '@runlith/performance/MemoryCaptures';
import * as MetricSnapshots from '@runlith/performance/MetricSnapshots';
import { performanceReportsLayer } from '@runlith/performance/PerformanceReports';
import { performanceStoreLayer } from '@runlith/performance/PerformanceStore';
import * as PerformanceTracer from '@runlith/performance/PerformanceTracer';
import * as ProcessVitals from '@runlith/performance/ProcessVitals';
import { LiveSettings, PERFORMANCE_DATABASE, PerformancePlace } from './contract/service/place.js';
import {
  cpuSampler,
  metricsIntervalMs,
  performanceKeepOneTraceIn,
  performancePendingLimit,
  performanceSpanMinMicros,
  performanceStorageLimit,
  vitalsIntervalMs,
} from './contract/wire/settings.js';

const STALL_CEILING_MS = 100;

const measuring = Layer.unwrap(
  Effect.gen(function* () {
    const place = yield* PerformancePlace;
    const settings = yield* LiveSettings;
    const maxStoredBytes = yield* settings.live(performanceStorageLimit);
    const maxPendingBytes = yield* settings.live(performancePendingLimit);
    const spanFloorMicros = yield* settings.live(performanceSpanMinMicros);
    const keepOneTraceIn = yield* settings.live(performanceKeepOneTraceIn);
    const vitalsInterval = yield* settings.live(vitalsIntervalMs);
    const standing = yield* settings.live(cpuSampler);
    const metricsInterval = yield* settings.live(metricsIntervalMs);
    const { instanceId } = place;
    const storeLayer = performanceStoreLayer({
      path: place.databasePath === ':memory:' ? ':memory:' : join(dirname(place.databasePath), PERFORMANCE_DATABASE),
      instanceId,
      maxStoredBytes,
      maxPendingBytes,
    });
    const metricLayer = MetricSnapshots.layer({ instanceId, intervalMs: metricsInterval });
    const tracerLayer = PerformanceTracer.layer({
      instanceId,
      recordFloorMicros: (place.spanFloorMicros ?? spanFloorMicros)(),
      keepOneTraceIn,
      units: place.units,
    }).pipe(Layer.provideMerge(metricLayer));
    const profiler = cpuProfilerLayer({
      instanceId,
      stallCeilingMs: STALL_CEILING_MS,
      windowMs: place.profileWindowMs ?? (() => (standing() ? vitalsInterval() : 0)),
    });
    return Layer.mergeAll(
      tracerLayer,
      LoopStalls.layer({ instanceId, ceilingMs: STALL_CEILING_MS }),
      ProcessVitals.layer({
        instanceId,
        intervalMs: vitalsInterval,
        ceiling: place.memoryCeiling,
      }),
      cpuProfilesLayer(),
      memoryCapturesLayer({ instanceId }),
      heapSnapshotsLayer({
        instanceId,
        directory: join(place.databasePath === ':memory:' ? tmpdir() : dirname(place.databasePath), 'heap-snapshots'),
      }),
      performanceReportsLayer,
    ).pipe(
      Layer.provideMerge(profiler),
      Layer.provideMerge(storeLayer),
      Layer.provideMerge(costLedgerLayer({ capacity: 4096 })),
      Layer.provideMerge(
        Layer.effect(
          WriterMetrics,
          Effect.map(MachineStore, (store) => store.processes.writerMetrics),
        ),
      ),
    );
  }),
);

export const performanceLayer = Layer.orDie(measuring);
