import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schedule from 'effect/Schedule';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import { PerformanceStoreUnavailable, type PerformanceRecord, type PerformanceSubmission } from './store/records.js';
import { PerformanceStore, performanceStoreLayer, performanceStoreWatchLayer } from './store/store.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { ringRoot } from './SegmentRing.js';

it.live('a watch reads what a live store keeps as it keeps it, and lets its open segment seal', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-watch-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      store.submit(vital('first', 1));
      yield* store.flush;

      const watched = yield* Layer.build(performanceReportsLayer.pipe(Layer.provide(performanceStoreWatchLayer({ path }))));
      const reports = Context.get(watched, PerformanceReports);
      const before = yield* reports.read({ type: 'vitals', limit: 10 });
      if (before.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(before.vitals.map((record) => record.id)).toEqual(['first']);

      for (let index = 0; index < 12; index += 1) store.submit(filler(index));
      yield* store.flush;
      store.submit(vital('after-roll', 2));
      yield* store.flush;
      expect(store.diagnostics().state).toBe('ready');
      expect(store.diagnostics().restarts).toBe(0);
      expect(readdirSync(join(ringRoot(path), 'segments')).filter((name) => name.endsWith('.sqlite')).length).toBe(2);

      const after = yield* reports.read({ type: 'vitals', limit: 10 });
      if (after.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(after.vitals.map((record) => record.id)).toEqual(['first', 'after-roll']);

      const memory = yield* reports.read({ type: 'memory' }).pipe(Effect.flip);
      expect(memory).toBeInstanceOf(PerformanceStoreUnavailable);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        performanceStoreLayer({
          path,
          instanceId: 'writer',
          maxPendingBytes: () => 64_000_000,
          maxStoredBytes: () => 16_000_000,
        }),
      ),
    );
  }),
);

it.live('a watch over a path no ring stands at answers unavailable and creates nothing there', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-watch-none-');
    const path = join(directory, 'performance.sqlite');
    const failure = yield* PerformanceReports.use((reports) => reports.read({ type: 'vitals', limit: 1 })).pipe(
      Effect.flip,
      Effect.provide(performanceReportsLayer.pipe(Layer.provide(performanceStoreWatchLayer({ path })))),
    );
    expect(failure).toBeInstanceOf(PerformanceStoreUnavailable);
    expect(existsSync(ringRoot(path))).toBe(false);
  }),
);

it.live('a watch unavailable at its first read recovers in the same reader when a writer creates the ring', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-watch-recovered-');
    const path = join(directory, 'performance.sqlite');
    const watched = yield* Layer.build(performanceReportsLayer.pipe(Layer.provide(performanceStoreWatchLayer({ path }))));
    const reports = Context.get(watched, PerformanceReports);
    const failed = yield* Effect.result(reports.read({ type: 'vitals', limit: 1 }));
    expect(failed._tag === 'Failure' ? failed.failure : null).toMatchObject({
      _tag: 'PerformanceStoreUnavailable',
      cause: { _tag: 'WorkerUnavailable' },
    });
    const writing = yield* Layer.build(
      performanceStoreLayer({
        path,
        instanceId: 'writer',
        maxPendingBytes: () => 64_000_000,
        maxStoredBytes: () => 16_000_000,
      }),
    );
    const store = Context.get(writing, PerformanceStore);
    store.submit(vital('recovered', 1));
    yield* store.flush;
    const read = yield* reports
      .read({ type: 'vitals', limit: 1 })
      .pipe(Effect.retry({ while: (failure) => failure._tag === 'PerformanceStoreUnavailable', schedule: Schedule.spaced('20 millis') }));
    expect(read.type === 'vitals' ? read.vitals.map((record) => record.id) : null).toEqual(['recovered']);
  }),
);

function vital(id: string, wallTime: number): PerformanceSubmission {
  const record: PerformanceRecord = {
    id,
    kind: 'vital',
    instanceId: 'writer',
    wallTime,
    monotonicStart: wallTime,
    monotonicEnd: wallTime + 1,
    payload: {
      cpu: { userMicros: 0, systemMicros: 0 },
      memory: { rssBytes: 1, heapTotalBytes: 1, heapUsedBytes: 1, externalBytes: 0, arrayBufferBytes: 0 },
      loopDelay: { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 },
    },
  };
  return { record, retentionKey: id, byteSize: 1_000 };
}

function filler(index: number): PerformanceSubmission {
  const record: PerformanceRecord = {
    id: `filler-${index}`,
    kind: 'span',
    instanceId: 'writer',
    wallTime: 1,
    monotonicStart: index,
    monotonicEnd: index + 1,
    traceId: `filler-${index}`,
    parentId: null,
    name: 'filler',
    payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: { project: 'x'.repeat(100_000) } },
  };
  return { record, retentionKey: record.id, byteSize: 100_000 };
}
