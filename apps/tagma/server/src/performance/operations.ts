import { CpuProfiles } from '@runlith/performance/CpuProfiles';
import { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import { MemoryCaptures } from '@runlith/performance/MemoryCaptures';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { Effect, FileSystem, Result } from 'effect';
import { WorldFiles } from '../executions/contract/service/worlds.js';
import { HostManagement } from '../executions/contract/service/host.js';
import { body, pair } from '../platform/contract/service/body.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { PERFORMANCE_OPERATIONS as OPS, WATCH_ROWS } from './contract/wire/operations.js';
import { watchReading } from '../platform/watch/tree.js';
import type { HandedArtifact, PerformanceReadValue } from './contract/wire/performance.js';
import { captureHeapSnapshot, captureMemoryReading, capturePerformanceProfile, readHostPerformance, readPerformance } from './reads.js';

type ReadAnswer = {
  readonly status: 'ok';
  readonly performance: PerformanceReadValue;
  readonly artifact?: HandedArtifact;
};

const handedOver = Effect.fnUntraced(function* (
  performance: PerformanceReadValue,
  caller: Caller,
): Effect.fn.Return<ReadAnswer, never, WorldFiles> {
  const kept = { status: 'ok' as const, performance };
  if (performance.type !== 'profile' || caller.actor.kind !== 'thread' || caller.files === null) return kept;
  if (performance.profile.payload.profile === undefined) return kept;
  const { files } = yield* WorldFiles;
  if (files === undefined) return kept;
  const { profile: artifact, ...payload } = performance.profile.payload;
  const directory = caller.files.path;
  const file = caller.files.resolve(`${performance.profile.id}.cpuprofile`);
  const text = JSON.stringify(artifact);
  const written = yield* Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.makeDirectory(directory, { recursive: true }).pipe(Effect.andThen(fs.writeFileString(file, text))),
  ).pipe(Effect.provide(files), Effect.result);
  if (Result.isFailure(written)) {
    yield* Effect.logWarning('a profile could not be written as a file for the thread, so it is handed over inline', {
      file,
      reason: written.failure.message,
    });
    return kept;
  }
  return {
    status: 'ok' as const,
    performance: { ...performance, profile: { ...performance.profile, payload } },
    artifact: { file, bytes: Buffer.byteLength(text) },
  };
});

export const PERFORMANCE_PAIRS = {
  capture_performance_profile: pair(
    OPS.capture_performance_profile,
    body(OPS.capture_performance_profile, {
      execute: Effect.fnUntraced(function* (input) {
        const performance = yield* capturePerformanceProfile(yield* CpuProfiles, input);
        return { status: 'ok' as const, performance };
      }),
    }),
  ),

  capture_memory_reading: pair(
    OPS.capture_memory_reading,
    body(OPS.capture_memory_reading, {
      execute: Effect.fnUntraced(function* (input) {
        const performance = yield* captureMemoryReading(yield* MemoryCaptures, input);
        return { status: 'ok' as const, performance };
      }),
    }),
  ),

  capture_heap_snapshot: pair(
    OPS.capture_heap_snapshot,
    body(OPS.capture_heap_snapshot, {
      execute: Effect.fnUntraced(function* (input) {
        const performance = yield* captureHeapSnapshot(yield* HeapSnapshots, input);
        return { status: 'ok' as const, performance };
      }),
    }),
  ),

  read_performance: pair(
    OPS.read_performance,
    body(OPS.read_performance, {
      execute: Effect.fnUntraced(function* (input, _prepared: undefined, caller: Caller) {
        return yield* handedOver(yield* readPerformance(yield* PerformanceReports, input), caller);
      }),
    }),
  ),

  read_host_performance: pair(
    OPS.read_host_performance,
    body(OPS.read_host_performance, {
      execute: Effect.fnUntraced(function* (input, _prepared: undefined, caller: Caller) {
        const state = input.state ?? (yield* HostManagement).connection.address.state;
        const performance = yield* readHostPerformance(state, input);
        return yield* handedOver(performance, caller);
      }),
    }),
  ),

  read_watches: pair(
    OPS.read_watches,
    body(OPS.read_watches, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'ok' as const, watches: watchReading(input.limit ?? WATCH_ROWS.default) };
      }),
    }),
  ),
};
