import type { CpuProfiles } from '@runlith/performance/CpuProfiles';
import type { HeapSnapshotRequest } from '@runlith/performance/HeapSnapshot';
import type { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import type { MemoryCaptures } from '@runlith/performance/MemoryCaptures';
import { PerformanceReports, performanceReportsLayer } from '@runlith/performance/PerformanceReports';
import { performanceStoreWatchLayer } from '@runlith/performance/PerformanceStore';
import { PERFORMANCE_FILE } from '@runlith/executions/protocol/registration';
import { join } from 'node:path';
import type { CpuProfileRequest } from '@runlith/performance/CpuProfile';
import type { MemoryCaptureRequest } from '@runlith/performance/protocol/records';
import type { PerformanceQuery } from '@runlith/performance/protocol/queries';
import { Context, Effect, Layer } from 'effect';
import type { PerformanceCaptureValue, PerformanceReadValue } from './contract/wire/performance.js';

export function readPerformance(
  reports: Context.Service.Shape<typeof PerformanceReports>,
  query: PerformanceQuery,
): Effect.Effect<PerformanceReadValue> {
  return reports.read(query).pipe(
    Effect.match({
      onFailure: (failure): PerformanceReadValue => {
        switch (failure._tag) {
          case 'PerformanceReportMissing':
            return {
              type: 'not-found',
              query: failure.query,
              inheritedDrops: failure.inheritedDrops,
              sessionDrops: failure.sessionDrops,
              inheritedDroppedKinds: failure.inheritedDroppedKinds,
              sessionDroppedKinds: failure.sessionDroppedKinds,
              retainedRange: failure.retainedRange,
            };
          case 'PerformanceStoreUnavailable':
            return { type: 'unavailable', message: failure.message };
          case 'PerformanceStoreQueryFailed':
            return { type: 'query-failed', message: failure.message };
          case 'PerformanceReportUnavailable':
            return { type: 'read-timed-out', message: failure.message };
        }
      },
      onSuccess: (report) => report,
    }),
  );
}

export function readHostPerformance(state: string, query: PerformanceQuery): Effect.Effect<PerformanceReadValue> {
  return PerformanceReports.use((reports) => readPerformance(reports, query)).pipe(
    Effect.provide(performanceReportsLayer.pipe(Layer.provide(performanceStoreWatchLayer({ path: join(state, PERFORMANCE_FILE) }))), {
      local: true,
    }),
  );
}

export function capturePerformanceProfile(
  profiles: Context.Service.Shape<typeof CpuProfiles>,
  request: CpuProfileRequest,
): Effect.Effect<PerformanceCaptureValue> {
  return profiles.capture(request).pipe(
    Effect.match({
      onFailure: (failure): PerformanceCaptureValue =>
        failure._tag === 'CpuProfileFailed'
          ? { type: 'capture-failed', operation: failure.operation, message: failure.message }
          : { type: 'unavailable', message: failure.message },
      onSuccess: ({ record, cuts }): PerformanceCaptureValue => ({ type: 'captured', profile: record, cuts }),
    }),
  );
}

export function captureMemoryReading(
  captures: Context.Service.Shape<typeof MemoryCaptures>,
  request: MemoryCaptureRequest,
): Effect.Effect<PerformanceCaptureValue> {
  return captures.capture(request).pipe(
    Effect.match({
      onFailure: (failure): PerformanceCaptureValue => ({
        type: 'reading-not-kept',
        reason: failure.reason,
        message: failure.message,
      }),
      onSuccess: (reading): PerformanceCaptureValue => ({ type: 'reading-kept', reading }),
    }),
  );
}

export function captureHeapSnapshot(
  snapshots: Context.Service.Shape<typeof HeapSnapshots>,
  request: HeapSnapshotRequest,
): Effect.Effect<PerformanceCaptureValue> {
  return snapshots.capture(request).pipe(
    Effect.match({
      onFailure: (failure): PerformanceCaptureValue => ({ type: 'snapshot-failed', step: failure.step, message: failure.message }),
      onSuccess: (snapshot): PerformanceCaptureValue => ({ type: 'snapshot-kept', snapshot }),
    }),
  );
}
