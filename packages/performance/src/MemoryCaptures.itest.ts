import { expect } from 'bun:test';
import { fullGC } from 'bun:jsc';
import { it } from '@runlith/effect-test';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Scope from 'effect/Scope';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import { MemoryCaptures, memoryCapturesLayer, MemoryCaptureUnavailable } from './MemoryCaptures.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import type { PerformanceStoreOptions } from './store/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';

const HELD_MAPS = 50_000;
const MAP_SLACK = 1_000;

it.live('two captures answer which object types grew between them', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-memory-captures-');
    const path = join(directory, 'performance.sqlite');
    const held: unknown[] = [];
    yield* Effect.gen(function* () {
      const captures = yield* MemoryCaptures;
      const reports = yield* PerformanceReports;

      fullGC();
      const before = yield* captures.capture({ requestedBy: 'test-before' });
      for (let index = 0; index < HELD_MAPS; index += 1) held.push(new Map([[index, `held ${index}`]]));
      fullGC();
      const after = yield* captures.capture({ requestedBy: 'test-after', collect: true });
      const collected = after.payload.collected;
      if (collected === undefined) return yield* Effect.die('the capture collected nothing');
      expect(collected.pauseMs).toBeGreaterThan(0);
      expect(after.payload.threads.map((thread) => thread.thread)).toEqual(['main', 'store-worker']);
      expect(collected.threads.map((thread) => thread.thread)).toEqual(['main', 'store-worker']);
      expect(collected.threads[0]?.heap.objectCount ?? 0).toBeGreaterThan(0);

      expect(before.payload.threads.map((thread) => thread.thread)).toEqual(['main', 'store-worker']);
      const reading = before.payload.threads[0];
      if (reading === undefined) return yield* Effect.die('the capture read no thread');
      expect(reading.largestTypes.length).toBeGreaterThan(12);
      expect(reading.censusMs).toBeGreaterThan(0);

      const list = yield* reports.read({ type: 'captures', limit: 10 });
      if (list.type !== 'captures') return yield* Effect.die('unexpected report');
      expect(list.captures.map((capture) => capture.payload.requestedBy)).toEqual(['test-before', 'test-after']);

      const growth = yield* reports.read({ type: 'growth', id: after.id });
      if (growth.type !== 'growth') return yield* Effect.die('unexpected report');
      expect(growth.from.id).toBe(before.id);
      expect(growth.threads.map((thread) => thread.thread)).toEqual(['main', 'store-worker']);
      const thread = growth.threads[0];
      if (thread === undefined) return yield* Effect.die('growth compared no thread');
      expect(thread.objectCountDelta).toBeGreaterThan(0);
      expect(thread.heapSizeDeltaBytes).toBeGreaterThan(0);
      const maps = thread.types.find((type) => type.name === 'Map');
      if (maps === undefined) return yield* Effect.die('the census counted no maps');
      expect(maps.after - maps.before).toBe(maps.delta);
      expect(Math.abs(maps.delta - HELD_MAPS)).toBeLessThan(MAP_SLACK);
      expect(held).toHaveLength(HELD_MAPS);
    }).pipe(Effect.provide(captureLayer(storeOptions(path))));
  }),
);

it.live('growth over a capture nobody kept is not-found', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-memory-missing-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const reports = yield* PerformanceReports;
      const missing = yield* Effect.flip(reports.read({ type: 'growth', id: 'nobody' }));
      expect(missing.message).toContain('nobody');

      const captures = yield* MemoryCaptures;
      const store = yield* PerformanceStore;
      const only = yield* captures.capture({ requestedBy: 'test-only' });
      yield* store.flush;
      const alone = yield* Effect.flip(reports.read({ type: 'growth', id: only.id }));
      expect(alone.message).toContain(only.id);
    }).pipe(Effect.provide(captureLayer(storeOptions(path))));
  }),
);

it.live('a capture that cannot be kept answers a typed reason', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-memory-not-kept-');
    const path = join(directory, 'performance.sqlite');
    const opened = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(captureLayer(storeOptions(path)), opened);
    const captures = Context.get(context, MemoryCaptures);
    yield* Scope.close(opened, Exit.void);
    const failure = yield* Effect.flip(captures.capture({ requestedBy: 'after-store-close' }));
    expect(failure).toBeInstanceOf(MemoryCaptureUnavailable);
    expect(failure.reason).toBe('store-unavailable');
  }),
);

function captureLayer(options: PerformanceStoreOptions) {
  return memoryCapturesLayer({ instanceId: 'process' }).pipe(
    Layer.provideMerge(performanceReportsLayer),
    Layer.provideMerge(performanceStoreLayer(options)),
  );
}

function storeOptions(path: string): PerformanceStoreOptions {
  return { path, instanceId: 'process', maxPendingBytes: () => 50_000_000, maxStoredBytes: () => 200_000_000 };
}
