import { expect } from 'bun:test';
import { fullGC } from 'bun:jsc';
import { it } from '@runlith/effect-test';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Queue from 'effect/Queue';
import * as Schema from 'effect/Schema';
import { join } from 'node:path';
import * as ProcessVitals from './ProcessVitals.js';
import type { PerformanceRecord, PerformanceStoreOptions } from './store/records.js';
import { vitalRecordSchema } from './protocol/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { scratchDirectory } from './testing/scratchDirectory.js';

const INTERVAL_MS = 100;
const BLOCK_MS = 250;
const HELD_OBJECTS = 50_000;

it.live('interval samples capture retained memory and reset loop delay after a synchronous block', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-process-vitals-');
    const path = join(directory, 'performance.sqlite');
    const held = new Map<number, { readonly index: number; readonly text: string }>();
    const samples = yield* Queue.unbounded<PerformanceRecord>();
    const sample = Effect.flatMap(Queue.take(samples), Schema.decodeUnknownEffect(vitalRecordSchema));
    const result = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        const reports = yield* PerformanceReports;
        fullGC();
        const before = yield* sample;

        for (let index = 0; index < HELD_OBJECTS; index += 1) {
          held.set(index, { index, text: `value-${index}-${index * index}` });
        }
        fullGC();
        yield* sample;
        const started = performance.now();
        blockLoop(BLOCK_MS);
        const ended = performance.now();
        yield* Effect.sleep(INTERVAL_MS * 3);
        yield* store.flush;
        const after = yield* reports.read({ type: 'vitals', limit: 50 });
        if (after.type !== 'vitals') return yield* Effect.die('unexpected report');
        return { before, after, started, ended };
      }),
    ).pipe(
      Effect.provide(ProcessVitals.layer({ instanceId: 'process', intervalMs: () => INTERVAL_MS })),
      Effect.provide(performanceLayer(path, samples)),
    );

    const added = result.after.vitals.filter((record) => record.id !== result.before.id);
    expect(added.length).toBeGreaterThan(1);

    const covering = added.filter((sample) => sample.monotonicStart <= result.started && sample.monotonicEnd >= result.ended);
    if (covering.length === 0) return yield* Effect.die('no vital window covered the deliberately blocked intervals');
    const blocked = covering.reduce((highest, sample) =>
      sample.payload.loopDelay.maxMs > highest.payload.loopDelay.maxMs ? sample : highest,
    );
    const latest = result.after.vitals.at(-1);
    if (latest === undefined) return yield* Effect.die('latest vital sample was not recorded');

    expect(blocked.payload.loopDelay.count).toBeGreaterThan(0);
    expect(blocked.payload.loopDelay.maxMs, JSON.stringify(blocked.payload.loopDelay)).toBeGreaterThan(BLOCK_MS / 2);
    expect(blocked.payload.loopDelay.p50Ms).toBeLessThanOrEqual(blocked.payload.loopDelay.p99Ms);
    expect(blocked.payload.loopDelay.p99Ms, JSON.stringify(blocked.payload.loopDelay)).toBeGreaterThan(0);
    for (const sample of added) {
      expect(sample.payload.loopDelay.maxMs).toBeLessThanOrEqual(sample.monotonicEnd - sample.monotonicStart);
    }
    expect(blocked.payload.cpu.userMicros + blocked.payload.cpu.systemMicros).toBeGreaterThan(0);
    expect(latest.payload.memory.heapUsedBytes).toBeGreaterThan(result.before.payload.memory.heapUsedBytes);
    const arenas = latest.payload.memory.allocator;
    if (arenas === undefined) return yield* Effect.die('the sample carried no allocator counters');
    expect(arenas.committedBytes).toBeGreaterThanOrEqual(arenas.rssBytes);
    expect(arenas.committedPeakBytes).toBeGreaterThanOrEqual(arenas.committedBytes);
    expect(held.size).toBe(HELD_OBJECTS);
  }),
);

it.live('closing the layer scope stops process sampling', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-process-vitals-scope-');
    const path = join(directory, 'performance.sqlite');
    const result = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        const reports = yield* PerformanceReports;
        yield* Effect.sleep(INTERVAL_MS * 2).pipe(
          Effect.provide(ProcessVitals.layer({ instanceId: 'process', intervalMs: () => INTERVAL_MS })),
        );
        yield* store.flush;
        const stoppedAt = yield* reports.read({ type: 'vitals', limit: 20 });
        yield* Effect.sleep(INTERVAL_MS * 2);
        yield* store.flush;
        const later = yield* reports.read({ type: 'vitals', limit: 20 });
        if (stoppedAt.type !== 'vitals' || later.type !== 'vitals') return yield* Effect.die('unexpected report');
        return { stoppedAt, later };
      }),
    ).pipe(Effect.provide(performanceLayer(path)));

    expect(result.stoppedAt.vitals.length).toBeGreaterThan(0);
    expect(result.later.vitals).toEqual(result.stoppedAt.vitals);
  }),
);

it.live('the next sample reads the current interval value', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-process-vitals-live-interval-');
    const path = join(directory, 'performance.sqlite');
    let reads = 0;
    const intervalMs = () => {
      reads += 1;
      return reads === 1 ? INTERVAL_MS : 20;
    };
    const page = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        const reports = yield* PerformanceReports;
        yield* Effect.sleep(250);
        yield* store.flush;
        return yield* reports.read({ type: 'vitals', limit: 20 });
      }),
    ).pipe(Effect.provide(ProcessVitals.layer({ instanceId: 'process', intervalMs })), Effect.provide(performanceLayer(path)));

    expect(reads).toBeGreaterThan(2);
    if (page.type !== 'vitals') return yield* Effect.die('unexpected report');
    expect(page.vitals.length).toBeGreaterThan(2);
  }),
);

it.live('retained memory past the ceiling is handed over once, however many windows stay above it', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-process-vitals-ceiling-');
    const path = join(directory, 'performance.sqlite');
    const handed: number[] = [];
    const crossed = yield* Deferred.make<void>();
    const samples = yield* Queue.unbounded<PerformanceRecord>();
    const sample = Effect.flatMap(Queue.take(samples), Schema.decodeUnknownEffect(vitalRecordSchema));
    yield* Effect.gen(function* () {
      yield* Deferred.await(crossed);
      yield* Queue.clear(samples);
      const after = yield* sample;
      expect(after.payload.loopDelay.maxMs).toBeGreaterThan(BLOCK_MS / 2);
      expect(after.payload.loopDelay.maxMs).toBeLessThanOrEqual(after.monotonicEnd - after.monotonicStart);
      yield* sample;
    }).pipe(
      Effect.provide(
        ProcessVitals.layer({
          instanceId: 'process',
          intervalMs: () => INTERVAL_MS / 4,
          ceiling: {
            bytes: 1,
            windowMs: INTERVAL_MS / 4,
            windows: 1,
            crossed: (crossing) =>
              Effect.sync(() => {
                handed.push(crossing.retainedBytes);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BLOCK_MS);
                Deferred.doneUnsafe(crossed, Effect.void);
              }),
          },
        }),
      ),
      Effect.provide(performanceLayer(path, samples)),
    );

    expect(handed).toHaveLength(1);
    expect(handed[0]).toBeGreaterThan(1);
  }),
);

function blockLoop(milliseconds: number): void {
  const started = performance.now();
  while (performance.now() - started < milliseconds) {}
}

function storeOptions(path: string): PerformanceStoreOptions {
  return { path, instanceId: 'process', maxPendingBytes: () => 1_000_000, maxStoredBytes: () => 1_000_000 };
}

function performanceLayer(path: string, samples?: Queue.Queue<PerformanceRecord>) {
  const layer = performanceReportsLayer.pipe(Layer.provideMerge(performanceStoreLayer(storeOptions(path))));
  if (samples === undefined) return layer;
  return Layer.effect(
    PerformanceStore,
    Effect.map(PerformanceStore, (store) =>
      PerformanceStore.of({
        ...store,
        submit: (submission) => {
          store.submit(submission);
          Queue.offerUnsafe(samples, submission.record);
        },
      }),
    ),
  ).pipe(Layer.provideMerge(layer));
}
