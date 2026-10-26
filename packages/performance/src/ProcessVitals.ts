import { gcAndSweep, memoryUsage } from 'bun:jsc';
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { monotonicMs } from './monotonic.js';
import { PerformanceStore } from './store/store.js';
import { recordByteSize, type PerformanceRecord } from './store/records.js';
import type { ProcessCpu, ProcessMemory, VitalPayload } from './protocol/records.js';
import { type HostPressure, readHostPressure } from './hostPressure.js';
import { RetainedCeiling, type RetainedWindows } from './RetainedCeiling.js';

const LOOP_DELAY_RESOLUTION_MS = 10;

export type MemoryCrossing = {
  readonly retainedBytes: number;
  readonly pressure: HostPressure;
  readonly sustained: boolean;
};

export type MemoryCeiling = RetainedWindows & {
  readonly crossed: (crossing: MemoryCrossing) => Effect.Effect<void>;
};

export type Options = {
  readonly instanceId: string;
  readonly intervalMs: () => number;
  readonly ceiling?: MemoryCeiling;
};

export type VitalRecord = PerformanceRecord<'vital', VitalPayload>;

export function processCpuDelta(previous: NodeJS.CpuUsage, current: NodeJS.CpuUsage): ProcessCpu {
  return {
    userMicros: current.user - previous.user,
    systemMicros: current.system - previous.system,
  };
}

function readAllocator(): ProcessMemory['allocator'] {
  const usage = memoryUsage() as Partial<Record<'current' | 'peak' | 'currentCommit' | 'peakCommit' | 'pageFaults', unknown>>;
  const numbers = ['current', 'peak', 'currentCommit', 'peakCommit', 'pageFaults'] as const;
  if (numbers.some((key) => typeof usage[key] !== 'number')) return undefined;
  return {
    rssBytes: usage.current as number,
    rssPeakBytes: usage.peak as number,
    committedBytes: usage.currentCommit as number,
    committedPeakBytes: usage.peakCommit as number,
    pageFaults: usage.pageFaults as number,
  };
}

export function readProcessMemory(): ProcessMemory {
  const memory = process.memoryUsage();
  const allocator = readAllocator();
  return {
    rssBytes: memory.rss,
    heapTotalBytes: memory.heapTotal,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBufferBytes: memory.arrayBuffers,
    allocator,
  };
}

const make = Effect.fnUntraced(function* (options: Options) {
  const store = yield* PerformanceStore;
  const histogram = yield* Effect.acquireRelease(
    Effect.sync(() => monitorEventLoopDelay({ resolution: LOOP_DELAY_RESOLUTION_MS })),
    (histogram) => Effect.sync(() => histogram.disable()),
  );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      histogram.reset();
      let previousCpu = process.cpuUsage();
      let intervalStart = yield* monotonicMs;
      let crossed = false;
      const ceiling = options.ceiling === undefined ? undefined : new RetainedCeiling(options.ceiling);
      histogram.enable();

      while (true) {
        yield* Effect.sleep(options.intervalMs());
        yield* Effect.sleep(LOOP_DELAY_RESOLUTION_MS);
        const observed = yield* monotonicMs;
        const wallTime = yield* Clock.currentTimeMillis;
        const currentCpu = process.cpuUsage();
        const record: VitalRecord = {
          id: randomUUID(),
          kind: 'vital',
          instanceId: options.instanceId,
          wallTime,
          monotonicStart: intervalStart,
          monotonicEnd: observed,
          payload: {
            cpu: processCpuDelta(previousCpu, currentCpu),
            memory: readProcessMemory(),
            loopDelay: {
              count: histogram.count,
              p50Ms: nanosecondsToMillis(histogram.percentile(50)),
              p99Ms: nanosecondsToMillis(histogram.percentile(99)),
              maxMs: nanosecondsToMillis(histogram.max),
            },
            store: store.pressure(),
          },
        };
        histogram.reset();
        previousCpu = currentCpu;
        intervalStart = observed;
        store.submit({ record, retentionKey: record.id, byteSize: recordByteSize(record) });
        if (!crossed && ceiling !== undefined && options.ceiling !== undefined) {
          const memory = record.payload.memory;
          const verdict = ceiling.observe(observed, memory.heapUsedBytes + memory.externalBytes);
          const pressure: HostPressure = verdict === 'hold' ? 'absent' : yield* Effect.promise(readHostPressure);
          if (verdict === 'sustained' || (verdict === 'pressed' && pressure === 'critical')) {
            const retainedBytes = collectedRetained();
            if (retainedBytes > options.ceiling.bytes) {
              crossed = true;
              yield* options.ceiling.crossed({ retainedBytes, pressure, sustained: verdict === 'sustained' });
            } else {
              ceiling.cleared();
            }
          }
        }
      }
    }).pipe(Effect.withTracerEnabled(false)),
  );
});

export const layer = (options: Options) => Layer.effectDiscard(make(options));

function collectedRetained(): number {
  gcAndSweep();
  const memory = process.memoryUsage();
  return memory.heapUsed + memory.external;
}

function nanosecondsToMillis(nanoseconds: number): number {
  return nanoseconds / 1_000_000;
}
