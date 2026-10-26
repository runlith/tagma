import { Duration, Effect, Layer, Metric } from 'effect';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CpuProfiler, cpuProfilerLayer } from '@runlith/performance/CpuProfiler';
import * as LoopStalls from '@runlith/performance/LoopStalls';
import * as MetricSnapshots from '@runlith/performance/MetricSnapshots';
import { PerformanceStore, performanceStoreLayer } from '@runlith/performance/PerformanceStore';
import * as PerformanceTracer from '@runlith/performance/PerformanceTracer';
import * as ProcessVitals from '@runlith/performance/ProcessVitals';
import { PERFORMANCE_FILE } from '@runlith/executions/protocol/registration';

export const hostSpan = <A, E, R>(
  verb: string,
  attributes: Record<string, string | number | undefined>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.withSpan(effect, `Host.${verb}`, { attributes });

export const reads = Metric.counter('host.reads', {
  incremental: true,
  description: 'Byte pulls answered, by outcome.',
});
export const readBytes = Metric.counter('host.read.bytes', {
  incremental: true,
  description: 'Bytes answered to byte readers.',
});
export const countRead = (bytes: number): Effect.Effect<void> =>
  Effect.andThen(Metric.update(Metric.withAttributes(reads, { outcome: 'answered' }), 1), Effect.asVoid(Metric.update(readBytes, bytes)));

export const refusals = Metric.counter('host.refusals', {
  incremental: true,
  description: 'Verbs answered with a refusal, by refusal tag.',
});
export const countRefusal = (tag: string): Effect.Effect<void> =>
  Effect.asVoid(Metric.update(Metric.withAttributes(refusals, { refusal: tag }), 1));

export const noteRefusal = (refusal: { readonly _tag: string; readonly reason: string }): Effect.Effect<void> =>
  Effect.andThen(Effect.annotateCurrentSpan({ refusal: refusal._tag, refusalReason: refusal.reason }), countRefusal(refusal._tag));

export const exhausted = Metric.counter('host.capacity.exhausted', {
  incremental: true,
  description: 'Capacity checks refused, by the budget that ran out.',
});
export const countExhaustion = (budget: string): Effect.Effect<void> =>
  Effect.asVoid(Metric.update(Metric.withAttributes(exhausted, { budget }), 1));

export const seats = Metric.counter('host.seats.reclaimed', {
  incremental: true,
  description: 'Connection seats handed back, by seat kind.',
});
export const countSeatReclaimed = (seat: 'ordinary' | 'reserved'): Effect.Effect<void> =>
  Effect.asVoid(Metric.update(Metric.withAttributes(seats, { seat }), 1));

export const credit = Metric.counter('host.credit.faults', {
  incremental: true,
  description: 'Subscription credit faults, by fault kind.',
});
export const countCreditFault = (fault: 'credit-exceeded' | 'grant-too-small'): Effect.Effect<void> =>
  Effect.asVoid(Metric.update(Metric.withAttributes(credit, { fault }), 1));

export const oversized = Metric.counter('host.deliveries.oversized', {
  incremental: true,
  description: 'Answers and deliveries refused for exceeding the frame ceiling, by site.',
});
export const countOversized = (site: 'reply' | 'delivery'): Effect.Effect<void> =>
  Effect.asVoid(Metric.update(Metric.withAttributes(oversized, { site }), 1));

export const evictions = Metric.counter('host.retention.evicted', {
  incremental: true,
  description: 'Record segments retention released, in segments.',
});
export const countRetentionEvicted = (segments: number): Effect.Effect<void> => Effect.asVoid(Metric.update(evictions, segments));

export const gridEntries = Metric.counter('host.record.grid', {
  incremental: true,
  description: 'Grid entries a terminal record took beside its bytes, one per resize that moved the grid its bytes are laid out at.',
});
export const countGridEntry: Effect.Effect<void> = Effect.suspend(() => Effect.asVoid(Metric.update(gridEntries, 1)));

export const reclaimedRows = Metric.counter('host.memory.reclaimed', {
  incremental: true,
  description: 'History rows reclaimed from executions.',
});
export const reclaimedBytes = Metric.counter('host.memory.reclaimed.bytes', {
  incremental: true,
  description: 'Bytes of history reclaimed from executions.',
});
export const countReclaimed = (rows: number, bytes: number): Effect.Effect<void> =>
  Effect.andThen(Metric.update(reclaimedRows, rows), Effect.asVoid(Metric.update(reclaimedBytes, bytes)));

export const memoryReserved = Metric.gauge('host.memory.reserved', {
  description: 'Bytes reserved by the executions this host holds.',
});
export const memoryRetained = Metric.gauge('host.memory.retained', {
  description: 'Bytes of interpreted history this host is holding.',
});
export const noteMemory = (reserved: number, retained: number): Effect.Effect<void> =>
  Effect.andThen(Metric.update(memoryReserved, reserved), Effect.asVoid(Metric.update(memoryRetained, retained)));

export const sendQueueDepth = Metric.gauge('host.send.queue.depth', {
  description: 'Admitted requests standing in the host queue.',
});
export const sendReplyWait = Metric.gauge('host.send.reply.wait', {
  description: 'Milliseconds the last reply spent being written.',
});
export const noteSendQueueDepth = (depth: number): Effect.Effect<void> => Effect.asVoid(Metric.update(sendQueueDepth, depth));
export const noteReplyWait = (ms: number): Effect.Effect<void> => Effect.asVoid(Metric.update(sendReplyWait, ms));

export const watchRounds = Metric.counter('host.watch.rounds', {
  incremental: true,
  description: 'Rounds the process watcher ran over the executions it proves process sets for.',
});
export const watchRoundTime = Metric.timer('host.watch.round', {
  description: 'How long one round of the process watcher took.',
});
export const watchDelayed = Metric.counter('host.watch.rounds.delayed', {
  incremental: true,
  description: 'Rounds that ran past their period and delayed the next.',
});
export const watchSkipped = Metric.counter('host.watch.rounds.skipped', {
  incremental: true,
  description: 'Whole periods no round started in, because the one before overran them.',
});
export const watchFailed = Metric.counter('host.watch.rounds.failed', {
  incremental: true,
  description: 'Rounds in which a reading failed and a set was left as it stood.',
});
export const noteWatchRound = (round: {
  readonly took: number;
  readonly delayed: boolean;
  readonly skipped: number;
  readonly failed: boolean;
}): Effect.Effect<void> =>
  Effect.all(
    [
      Metric.update(watchRounds, 1),
      Metric.update(watchRoundTime, Duration.millis(round.took)),
      Metric.update(watchDelayed, round.delayed ? 1 : 0),
      Metric.update(watchSkipped, round.skipped),
      Metric.update(watchFailed, round.failed ? 1 : 0),
    ],
    { discard: true },
  );

export const fiberDeaths = Metric.counter('host.fibers.failed', {
  incremental: true,
  description: 'Background fibers that failed rather than ending, by fiber.',
});
export const countFiberFailed = (fiber: string): Effect.Effect<void> =>
  Effect.asVoid(Metric.update(Metric.withAttributes(fiberDeaths, { fiber }), 1));
export const reportDeadFiber = <A, E, R>(fiber: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.tapDefect(effect, (defect) =>
    Effect.andThen(Effect.logError(`host background fiber '${fiber}' died`, defect), countFiberFailed(fiber)),
  );

export type HostTelemetryOptions = {
  readonly recordFloorMicros?: number;
  readonly stallCeilingMs?: number;
  readonly vitalsIntervalMs?: () => number;
  readonly metricsIntervalMs?: () => number;
  readonly maxStoredBytes?: () => number;
  readonly maxPendingBytes?: () => number;
  readonly busy?: { readonly cpuShare: number; readonly everyMs: number };
};

export const hostTelemetry = (
  state: string,
  options: HostTelemetryOptions = {},
): Layer.Layer<CpuProfiler | PerformanceStore, never, never> => {
  const instanceId = randomUUID();
  const recordFloorMicros = options.recordFloorMicros ?? 15;
  const stallCeilingMs = options.stallCeilingMs ?? 100;
  const vitalsIntervalMs = options.vitalsIntervalMs ?? (() => 5_000);
  const metricsIntervalMs = options.metricsIntervalMs ?? (() => 60_000);
  const maxStoredBytes = options.maxStoredBytes ?? (() => 512 * 1024 * 1024);
  const maxPendingBytes = options.maxPendingBytes ?? (() => 64 * 1024 * 1024);
  const store = performanceStoreLayer({
    path: join(state, PERFORMANCE_FILE),
    instanceId,
    maxStoredBytes,
    maxPendingBytes,
  });
  const metrics = MetricSnapshots.layer({ instanceId, intervalMs: metricsIntervalMs });
  const tracer = PerformanceTracer.layer({ instanceId, recordFloorMicros }).pipe(Layer.provideMerge(metrics));
  const profiler = cpuProfilerLayer({
    instanceId,
    stallCeilingMs,
    windowMs: vitalsIntervalMs,
    busy: options.busy ?? { cpuShare: 0.5, everyMs: 60_000 },
  });
  return Layer.mergeAll(
    tracer,
    LoopStalls.layer({ instanceId, ceilingMs: stallCeilingMs }),
    ProcessVitals.layer({ instanceId, intervalMs: vitalsIntervalMs }),
  ).pipe(Layer.provideMerge(profiler), Layer.provideMerge(store));
};
