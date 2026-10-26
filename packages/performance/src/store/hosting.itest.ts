import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Queue from 'effect/Queue';
import { join } from 'node:path';
import { PerformanceReportMissing, PerformanceReports, performanceReportsLayer } from '../PerformanceReports.js';
import { scratchDirectory } from '../testing/scratchDirectory.js';
import { localStorePreparationLayer } from '../testing/worker.js';
import { recordByteSize, type PerformanceRecord } from './records.js';
import { PerformanceStore, PreparedStoreWorker, performancePreparationLayer, performanceStoreLayer } from './store.js';
import type { StoreAnswer } from './wire.js';

for (const [hosting, preparation, transportPreparation] of [
  ['thread', Layer.empty, performancePreparationLayer],
  ['in-process', localStorePreparationLayer, localStorePreparationLayer],
] as const) {
  it.live(`${hosting} store hosting retains a report accepted before its receiver starts`, () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(transportPreparation);
      const worker = yield* PreparedStoreWorker.pipe(Effect.provide(context));
      if (worker === undefined) return yield* Effect.die('the preparation did not provide its worker');
      yield* worker.send({ _tag: 'ReadReport', requestId: 'early', query: { type: 'vitals', limit: 1 } });
      yield* worker.send({ _tag: 'InitializeStore', path: ':memory:', instanceId: 'process', maxStoredBytes: 1_000_000 });
      const answers = yield* Queue.unbounded<StoreAnswer>();
      yield* Effect.forkScoped(worker.run((answer) => Effect.asVoid(Queue.offer(answers, answer))));
      expect((yield* Queue.take(answers))._tag).toBe('StoreReady');
      const report = yield* Queue.take(answers);
      expect(report._tag).toBe('ReportDone');
      if (report._tag !== 'ReportDone' || report.report.type !== 'vitals')
        return yield* Effect.die('the early report did not answer vitals');
      expect(report.requestId).toBe('early');
      expect(report.report.vitals).toEqual([]);
    }),
  );
  it.live(`${hosting} store hosting acknowledges durability, pages equal timestamps and reopens the same SQL records`, () =>
    Effect.gen(function* () {
      const directory = yield* scratchDirectory('performance-hosting-');
      const layer = performanceReportsLayer.pipe(
        Layer.provideMerge(
          performanceStoreLayer({
            path: join(directory, 'performance.sqlite'),
            instanceId: 'process',
            maxPendingBytes: () => 1_000_000,
            maxStoredBytes: () => 1_000_000,
          }),
        ),
        Layer.provide(preparation),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const services = yield* Layer.build(layer);
          const store = Context.get(services, PerformanceStore);
          const reports = Context.get(services, PerformanceReports);
          for (const id of ['a', 'b']) {
            const record: PerformanceRecord = {
              id,
              kind: 'vital',
              instanceId: 'process',
              wallTime: 1,
              monotonicStart: 0,
              monotonicEnd: 1,
              payload: {
                cpu: { userMicros: 1, systemMicros: 0 },
                memory: { rssBytes: 1, heapTotalBytes: 1, heapUsedBytes: 1, externalBytes: 0, arrayBufferBytes: 0 },
                loopDelay: { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 },
              },
            };
            yield* store.submitDurable({ record, retentionKey: id, byteSize: recordByteSize(record) });
          }
          const first = yield* reports.read({ type: 'vitals', limit: 1 });
          if (first.type !== 'vitals') return yield* Effect.die('expected a vitals page');
          expect(first.vitals.map((record) => record.id)).toEqual(['a']);
          if (first.next === null) return yield* Effect.die('the first page lost its continuation');
          const second = yield* reports.read({ type: 'vitals', limit: 1, after: first.next });
          if (second.type !== 'vitals') return yield* Effect.die('expected the next vitals page');
          expect(second.vitals.map((record) => record.id)).toEqual(['b']);
          expect(second.next).toBeNull();
          expect(yield* Effect.flip(reports.read({ type: 'profile', id: 'absent' }))).toBeInstanceOf(PerformanceReportMissing);
        }),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reports = Context.get(yield* Layer.build(layer), PerformanceReports);
          const reopened = yield* reports.read({ type: 'vitals', limit: 2 });
          if (reopened.type !== 'vitals') return yield* Effect.die('expected retained vitals');
          expect(reopened.vitals.map((record) => record.id)).toEqual(['a', 'b']);
        }),
      );
    }),
  );
}
