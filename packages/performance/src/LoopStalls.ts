import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { randomUUID } from 'node:crypto';
import { monotonicMs } from './monotonic.js';
import { PerformanceStore } from './store/store.js';
import { recordByteSize, type PerformanceRecord } from './store/records.js';
import { processCpuDelta, readProcessMemory } from './ProcessVitals.js';
import type { StallPayload } from './protocol/records.js';
import { CpuProfiler } from './CpuProfiler.js';
import { CurrentTraceSampler } from './TraceSampler.js';

export type Options = {
  readonly instanceId: string;
  readonly ceilingMs: number;
};

export type StallRecord = PerformanceRecord<'stall', StallPayload>;

type CpuUsage = ReturnType<typeof process.cpuUsage>;

const readLoopCpu = (): CpuUsage | undefined => (typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : undefined);

const make = Effect.fnUntraced(function* (options: Options) {
  const store = yield* PerformanceStore;
  const profiles = yield* CpuProfiler;
  const sampler = yield* CurrentTraceSampler;
  const pulseMs = options.ceilingMs / 4;

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      let expected = (yield* monotonicMs) + pulseMs;
      let previousCpu = process.cpuUsage();
      let previousLoopCpu = readLoopCpu();
      let previousCpuAt = yield* monotonicMs;

      while (true) {
        yield* Effect.sleep(pulseMs);
        const observed = yield* monotonicMs;
        const currentCpu = process.cpuUsage();
        const currentLoopCpu = readLoopCpu();
        const delayMs = observed - expected;

        if (delayMs > options.ceilingMs) {
          const wallTime = yield* Clock.currentTimeMillis;
          sampler.coverStall(expected, observed);
          const profile = yield* profiles.cut('stall');
          const record: StallRecord = {
            id: randomUUID(),
            kind: 'stall',
            instanceId: options.instanceId,
            wallTime,
            monotonicStart: expected,
            monotonicEnd: observed,
            payload: {
              delayMs,
              cpu: processCpuDelta(previousCpu, currentCpu),
              loopCpu:
                previousLoopCpu === undefined || currentLoopCpu === undefined
                  ? undefined
                  : processCpuDelta(previousLoopCpu, currentLoopCpu),
              cpuWindowMs: Math.max(0, observed - previousCpuAt),
              memory: readProcessMemory(),
              profileId: profile === null ? undefined : profile.id,
            },
          };
          store.submit({ record, retentionKey: record.id, byteSize: recordByteSize(record) });
        }

        previousCpu = process.cpuUsage();
        previousLoopCpu = readLoopCpu();
        previousCpuAt = yield* monotonicMs;
        expected = previousCpuAt + pulseMs;
      }
    }).pipe(Effect.withTracerEnabled(false)),
  );
});

export const layer = (options: Options) => Layer.effectDiscard(make(options));
