import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { PERFORMANCE_FILE } from '@runlith/executions/protocol/registration';
import { PerformanceReports, performanceReportsLayer } from '@runlith/performance/PerformanceReports';
import { PerformanceStore, performanceStoreLayer } from '@runlith/performance/PerformanceStore';
import type { PerformanceSubmission } from '@runlith/performance/store/records';
import { readHostPerformance } from './reads.js';

const vital = (id: string): PerformanceSubmission => ({
  retentionKey: id,
  byteSize: 500,
  record: {
    id,
    kind: 'vital',
    instanceId: id,
    wallTime: 1,
    monotonicStart: 0,
    monotonicEnd: 1,
    payload: {
      cpu: { userMicros: 0, systemMicros: 0 },
      memory: { rssBytes: 1, heapTotalBytes: 1, heapUsedBytes: 1, externalBytes: 0, arrayBufferBytes: 0 },
      loopDelay: { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 },
    },
  },
});

const storeAt = (path: string, instanceId: string) =>
  performanceStoreLayer({
    path,
    instanceId,
    maxPendingBytes: () => 64_000,
    maxStoredBytes: () => 1_000_000,
  });

layer(BunFileSystem.layer, { excludeTestServices: true })('host performance reads', (it) => {
  it.effect('host readings stay on the host ring beside the server reports and refuse process-local questions', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const state = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'tagma-host-read-' });
      yield* PerformanceStore.use((store) =>
        Effect.gen(function* () {
          store.submit(vital('host'));
          yield* store.flush;
        }),
      ).pipe(Effect.provide(storeAt(join(state, PERFORMANCE_FILE), 'host')));

      yield* Effect.gen(function* () {
        const store = yield* PerformanceStore;
        store.submit(vital('server'));
        yield* store.flush;
        const server = yield* (yield* PerformanceReports).read({ type: 'vitals', limit: 1 });
        if (server.type !== 'vitals') return yield* Effect.die('expected server vitals');
        expect(server.vitals.map((row) => row.instanceId)).toEqual(['server']);

        const host = yield* readHostPerformance(state, { type: 'vitals', limit: 1 });
        if (host.type !== 'vitals') return yield* Effect.die(`expected host vitals, got ${host.type}`);
        expect(host.vitals.map((row) => row.instanceId)).toEqual(['host']);
        const live = yield* readHostPerformance(state, { type: 'losses', source: 'live', limit: 1 });
        expect(live.type).toBe('unavailable');
      }).pipe(Effect.provide(performanceReportsLayer.pipe(Layer.provideMerge(storeAt(':memory:', 'server')))));
    }),
  );
});
