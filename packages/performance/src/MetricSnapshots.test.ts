import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Clock from 'effect/Clock';
import * as Deferred from 'effect/Deferred';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Metric from 'effect/Metric';
import * as Schema from 'effect/Schema';
import { TestClock } from 'effect/testing';
import * as MetricSnapshots from './MetricSnapshots.js';
import * as PerformanceTracer from './PerformanceTracer.js';
import { metricRecordSchema } from './protocol/records.js';
import type { PerformanceRecord } from './store/records.js';
import { PerformanceStore } from './store/store.js';

it.effect(
  'each process registry emits zero origins and cumulative finite buckets for every measured name, including failures at scope close',
  () =>
    Effect.gen(function* () {
      const emitted: PerformanceRecord[] = [];
      const outside = Metric.timer('outside', { attributes: { source: 'span', measure: 'duration' } });
      yield* Metric.update(outside, Duration.millis(1));
      for (const instanceId of ['a', 'b']) {
        yield* Effect.gen(function* () {
          yield* Effect.void.pipe(Effect.withSpan('alpha'));
          yield* Effect.void.pipe(Effect.withSpan('beta'));
          yield* TestClock.adjust(100);
          yield* (instanceId === 'a' ? Effect.void : Effect.fail('refused')).pipe(Effect.withSpan('alpha'), Effect.result);
          yield* Effect.void.pipe(Effect.withSpan('beta'));
        }).pipe(
          Effect.provide(
            PerformanceTracer.layer({ instanceId, recordFloorMicros: 0 }).pipe(
              Layer.provideMerge(MetricSnapshots.layer({ instanceId, intervalMs: () => 100 })),
            ),
          ),
          Effect.provide(recording(emitted)),
        );
      }
      const snapshots = yield* Effect.forEach(
        emitted.filter((record) => record.kind === 'metric'),
        (record) => Schema.decodeUnknownEffect(metricRecordSchema)(record),
      );
      expect([...new Set(snapshots.map((record) => record.name))].sort()).toEqual(['alpha', 'beta']);
      for (const instanceId of ['a', 'b']) {
        for (const name of ['alpha', 'beta']) {
          const series = snapshots.filter((record) => record.instanceId === instanceId && record.name === name);
          expect(series.map((record) => record.payload.count)).toEqual([0, 1, 2]);
          expect(series.map((record) => record.payload.failures)).toEqual([0, 0, instanceId === 'b' && name === 'alpha' ? 1 : 0]);
          for (const { payload } of series) {
            expect(payload.boundariesMs.every(Number.isFinite)).toBe(true);
            expect(payload.bucketCounts).toHaveLength(payload.boundariesMs.length + 1);
            expect(payload.bucketCounts.reduce((sum, count) => sum + count, 0)).toBe(payload.count);
          }
        }
      }
    }),
);

it.effect('the next tick takes the current interval and closing its layer emits the final snapshot and stops the fiber', () =>
  Effect.gen(function* () {
    const emitted: PerformanceRecord[] = [];
    const start = yield* Clock.currentTimeMillis;
    let interval = 100;
    const began = yield* Deferred.make<void>();
    const intervalMs = () => {
      const current = interval;
      Deferred.doneUnsafe(began, Effect.void);
      return current;
    };
    yield* Effect.gen(function* () {
      yield* Effect.void.pipe(Effect.withSpan('reread'));
      yield* Deferred.await(began);
      interval = 20;
      yield* TestClock.adjust(140);
    }).pipe(
      Effect.provide(
        PerformanceTracer.layer({ instanceId: 'process', recordFloorMicros: 0 }).pipe(
          Layer.provideMerge(MetricSnapshots.layer({ instanceId: 'process', intervalMs })),
        ),
      ),
      Effect.provide(recording(emitted)),
    );
    const snapshots = emitted.filter((record) => record.kind === 'metric');
    expect(snapshots.map((record) => record.wallTime - start)).toEqual([0, 100, 120, 140, 140]);
    const stopped = [...emitted];
    yield* TestClock.adjust(1_000);
    expect(emitted).toEqual(stopped);
  }),
);

function recording(emitted: PerformanceRecord[]) {
  return Layer.mock(PerformanceStore, {
    openGroup: () => {},
    closeGroup: () => {},
    submit: (submission) => void emitted.push(submission.record),
    flush: Effect.void,
    pressure: () => {
      throw new Error('the collector does not read store pressure');
    },
    diagnostics: () => {
      throw new Error('the collector does not read store diagnostics');
    },
  });
}
