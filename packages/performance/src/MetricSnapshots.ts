import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Metric from 'effect/Metric';
import { randomUUID } from 'node:crypto';
import { monotonicMs } from './monotonic.js';
import { PerformanceStore } from './store/store.js';
import { recordByteSize, type PerformanceRecord } from './store/records.js';
import type { MetricSamplePayload } from './protocol/records.js';

export type Options = {
  readonly instanceId: string;
  readonly intervalMs: () => number;
};

export type MetricSample = PerformanceRecord<'metric', MetricSamplePayload>;

const make = Effect.fnUntraced(function* (options: Options) {
  const store = yield* PerformanceStore;
  const startedAt = yield* Clock.currentTimeMillis;
  const startedMonotonic = yield* monotonicMs;
  const initialized = new Set<string>();

  const writeSnapshot = Effect.fnUntraced(function* () {
    const snapshots = yield* Metric.snapshot;
    const failureCounts = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (snapshot.type === 'Counter' && snapshot.attributes?.source === 'span' && snapshot.attributes.measure === 'failure') {
        failureCounts.set(snapshot.id, Number(snapshot.state.count));
      }
    }

    const wallTime = yield* Clock.currentTimeMillis;
    const monotonicTime = yield* monotonicMs;
    const retentionKey = randomUUID();
    for (const snapshot of snapshots) {
      if (snapshot.type !== 'Histogram' || snapshot.attributes?.source !== 'span' || snapshot.attributes.measure !== 'duration') {
        continue;
      }

      let previous = 0;
      const bucketCounts = snapshot.state.buckets.map(([, cumulative]) => {
        const count = cumulative - previous;
        previous = cumulative;
        return count;
      });
      const record: MetricSample = {
        id: randomUUID(),
        kind: 'metric',
        instanceId: options.instanceId,
        wallTime,
        monotonicStart: monotonicTime,
        monotonicEnd: monotonicTime,
        name: snapshot.id,
        payload: {
          boundariesMs: snapshot.state.buckets.slice(0, -1).map(([boundary]) => boundary),
          bucketCounts,
          count: snapshot.state.count,
          failures: failureCounts.get(snapshot.id) ?? 0,
          sumMs: snapshot.state.sum,
          minMs: snapshot.state.min,
          maxMs: snapshot.state.max,
        },
      };
      if (!initialized.has(snapshot.id)) {
        const baseline: MetricSample = {
          ...record,
          id: `0-${record.id}`,
          wallTime: startedAt,
          monotonicStart: startedMonotonic,
          monotonicEnd: startedMonotonic,
          payload: { ...record.payload, bucketCounts: bucketCounts.map(() => 0), count: 0, failures: 0, sumMs: 0, minMs: 0, maxMs: 0 },
        };
        store.submit({ record: baseline, retentionKey, byteSize: recordByteSize(baseline) });
        initialized.add(snapshot.id);
      }
      store.submit({ record, retentionKey, byteSize: recordByteSize(record) });
    }
  });

  yield* Effect.addFinalizer(() => writeSnapshot().pipe(Effect.andThen(store.flush), Effect.withTracerEnabled(false)));
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(options.intervalMs());
        yield* writeSnapshot();
      }
    }).pipe(Effect.withTracerEnabled(false)),
  );
});

export const layer = (options: Options) => {
  const registry = Layer.sync(Metric.MetricRegistry, () => new Map());
  return Layer.effectDiscard(make(options)).pipe(Layer.provideMerge(registry));
};
