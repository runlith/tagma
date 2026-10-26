import { gcAndSweep } from 'bun:jsc';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { randomUUID } from 'node:crypto';
import { takeMemoryReading } from './MemoryReading.js';
import { monotonicMs } from './monotonic.js';
import type { MemoryCaptureRequest, StoredMemoryRecord } from './protocol/records.js';
import { PerformanceStore } from './store/store.js';
import { type PerformanceRecordFailure, PerformanceStoreUnavailable, recordByteSize } from './store/records.js';

export type Options = {
  readonly instanceId: string;
};

export class MemoryCaptureRefused extends Data.TaggedError('MemoryCaptureRefused')<{
  readonly reason: 'pending-limit';
  readonly message: string;
}> {}

export class MemoryCaptureUnavailable extends Data.TaggedError('MemoryCaptureUnavailable')<{
  readonly reason: 'store-unavailable';
  readonly message: string;
}> {}

export type MemoryCaptureFailure = MemoryCaptureRefused | MemoryCaptureUnavailable;

export class MemoryCaptures extends Context.Service<
  MemoryCaptures,
  {
    readonly capture: (request: MemoryCaptureRequest) => Effect.Effect<StoredMemoryRecord, MemoryCaptureFailure>;
  }
>()('@runlith/performance/MemoryCaptures') {}

export const memoryCapturesLayer = (options: Options) => Layer.effect(MemoryCaptures, make(options));

const make = Effect.fnUntraced(function* (options: Options) {
  const store = yield* PerformanceStore;
  return MemoryCaptures.of({
    capture: Effect.fnUntraced(
      function* (request) {
        const wallTime = yield* Clock.currentTimeMillis;
        const monotonicStart = yield* monotonicMs;
        const worker = yield* store.readWorkerMemory(request.collect === true);
        const main = yield* takeMainMemory(request.collect === true);
        const id = randomUUID();
        const record: StoredMemoryRecord = {
          id,
          kind: 'memory',
          instanceId: options.instanceId,
          wallTime,
          monotonicStart,
          monotonicEnd: yield* monotonicMs,
          payload: {
            requestedBy: request.requestedBy,
            threads: [main.reading, worker.reading],
            collected:
              request.collect !== true
                ? undefined
                : {
                    pauseMs: main.collected!.pauseMs,
                    threads: [main.collected!.reading, worker.collected!.reading],
                  },
          },
        };
        yield* store.submitDurable({ record, retentionKey: id, byteSize: recordByteSize(record) });
        return record;
      },
      Effect.mapError((failure: PerformanceStoreUnavailable | PerformanceRecordFailure) =>
        failure._tag === 'PerformanceRecordRefused'
          ? new MemoryCaptureRefused({ reason: 'pending-limit', message: failure.message })
          : new MemoryCaptureUnavailable({ reason: 'store-unavailable', message: failure.message }),
      ),
      Effect.withTracerEnabled(false),
    ),
  });
});

const takeMainMemory = Effect.fnUntraced(function* (collect: boolean): Effect.fn.Return<{
  readonly reading: ReturnType<typeof takeMemoryReading>;
  readonly collected?: { readonly pauseMs: number; readonly reading: ReturnType<typeof takeMemoryReading> };
}> {
  const reading = takeMemoryReading('main', 'all');
  if (!collect) return { reading };
  const started = yield* monotonicMs;
  gcAndSweep();
  const pauseMs = (yield* monotonicMs) - started;
  return { reading, collected: { pauseMs, reading: takeMemoryReading('main', 'all') } };
});
