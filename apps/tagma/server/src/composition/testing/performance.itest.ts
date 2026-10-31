import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { PERFORMANCE_FILE } from '@runlith/executions/protocol/registration';
import { PerformanceStore, performanceStoreLayer } from '@runlith/performance/PerformanceStore';
import { recordByteSize } from '@runlith/performance/store/records';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { performanceReadValueSchema } from '../../performance/contract/wire/performance.js';
import { readPerformance } from '../../performance/reads.js';
import { Settings } from '../../settings/contract/service/values.js';
import { performanceKeepOneTraceIn, performanceSpanMinMicros } from '../../performance/contract/wire/settings.js';
import { DoorFixture, doorFixture } from './doorFixture.js';

type World = Context.Service.Shape<typeof DoorFixture>;

const read = (world: World, init: { method: string; body: unknown }) =>
  Effect.map(world.call('/api/op/read_performance', init), (response) => ({
    status: response.status,
    body: (response.body as { readonly performance?: unknown }).performance,
  }));

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('performance door', (it) => {
  it.effect('HTTP and the runtime projection answer one PerformanceReadValue contract', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const context = yield* world.runtime.runtime.contextEffect;
      const settings = Context.get(context, Settings);
      const kept = (yield* settings.read(performanceKeepOneTraceIn)).layers.user;
      yield* Effect.addFinalizer(() =>
        settings
          .write({ scope: 'user', key: performanceKeepOneTraceIn.id, value: kept?.value, declined: kept?.declined })
          .pipe(Effect.orDie),
      );
      yield* settings.write({ scope: 'user', key: performanceKeepOneTraceIn.id, value: 1 });
      yield* Effect.provide(
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({ writersHeld: true, privateData: 'not retained' });
            yield* Effect.sleep(Math.floor(performanceSpanMinMicros.fallback / 1_000) + 1);
          }).pipe(Effect.withSpan('performance.http.probe'));
          const store = yield* PerformanceStore;
          for (const [id, parentId, start, end] of [
            ['http-parent', null, 0, 100],
            ['http-first', 'http-parent', 10, 70],
            ['http-second', 'http-parent', 50, 90],
          ] as const) {
            const record = {
              id,
              kind: 'span',
              instanceId: 'http-fixture',
              traceId: 'http-fixture',
              parentId,
              name: id,
              wallTime: 1,
              monotonicStart: start,
              monotonicEnd: end,
              payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: {} },
            } as const;
            store.submit({ record, byteSize: recordByteSize(record), retentionKey: 'http-fixture' });
          }
          yield* store.flush;
        }),
        context,
      );
      const reports = Context.get(world.runtime.measurement, PerformanceReports);
      const query = { type: 'slow', name: 'performance.http.probe', limit: 10 } as const;
      const expected = yield* readPerformance(reports, query);
      const response = yield* read(world, { method: 'POST', body: query });
      expect(response.status).toBe(200);
      const received = yield* Schema.decodeUnknownEffect(performanceReadValueSchema)(response.body);
      expect(expected.type).toBe('slow');
      expect(received.type).toBe('slow');
      if (expected.type !== 'slow' || received.type !== 'slow') return;
      expect(received.spans).toEqual(expected.spans);
      expect(received.inheritedDrops).toBe(expected.inheritedDrops);
      expect(received.sessionDrops).toBe(expected.sessionDrops);
      expect(received.retainedRange?.from).toBeLessThanOrEqual(expected.retainedRange?.from ?? Number.MAX_SAFE_INTEGER);
      expect(received.retainedRange?.to).toBeGreaterThanOrEqual(expected.retainedRange?.to ?? 0);
      const probe = received.spans.find((span) => span.name === 'performance.http.probe');
      expect(probe).toBeDefined();
      if (probe === undefined) return;
      const trace = yield* read(world, { method: 'POST', body: { type: 'trace', traceId: probe.traceId, limit: 100 } });
      expect(trace.status).toBe(200);
      const traceBody = yield* Schema.decodeUnknownEffect(performanceReadValueSchema)(trace.body);
      expect(traceBody.type).toBe('trace');
      if (traceBody.type !== 'trace') return;
      const persistedProbe = traceBody.segments.flatMap((segment) => segment.spans).find((span) => span.id === probe.id);
      expect(persistedProbe?.payload.attributes).toEqual({ 'thread.snapshot.writers_held': true });

      const breakdownQuery = { type: 'breakdown', id: 'http-parent', limit: 1 } as const;
      const expectedBreakdown = yield* readPerformance(reports, breakdownQuery);
      const breakdownResponse = yield* read(world, { method: 'POST', body: breakdownQuery });
      expect(breakdownResponse.status).toBe(200);
      const breakdown = yield* Schema.decodeUnknownEffect(performanceReadValueSchema)(breakdownResponse.body);
      expect(breakdown.type).toBe('breakdown');
      expect(expectedBreakdown.type).toBe('breakdown');
      if (breakdown.type !== 'breakdown' || expectedBreakdown.type !== 'breakdown') return;
      expect(breakdown.span).toEqual(expectedBreakdown.span);
      expect(breakdown.children).toEqual(expectedBreakdown.children);
      expect(breakdown).toMatchObject({
        coveredMs: 80,
        selfMs: 20,
        totalChildren: 2,
        evidence: 'retained-only',
        children: [{ id: 'http-first', durationMs: 60, coveredMs: 60 }],
        next: { coveredMs: 60, id: 'http-first' },
      });
      const continuation = yield* read(world, {
        method: 'POST',
        body: { ...breakdownQuery, after: breakdown.next },
      });
      expect(continuation).toMatchObject({
        status: 200,
        body: {
          type: 'breakdown',
          children: [{ id: 'http-second', durationMs: 40, coveredMs: 40 }],
          coveredMs: 80,
          selfMs: 20,
          next: null,
        },
      });
      const missingBreakdown = yield* read(world, {
        method: 'POST',
        body: { type: 'breakdown', id: 'missing-span', limit: 1 },
      });
      expect(missingBreakdown).toMatchObject({
        status: 200,
        body: {
          type: 'not-found',
          query: { type: 'breakdown', id: 'missing-span', limit: 1 },
        },
      });

      const missing = yield* read(world, {
        method: 'POST',
        body: { type: 'profile', id: 'missing-profile' },
      });
      expect(missing).toMatchObject({
        status: 200,
        body: { type: 'not-found', query: { type: 'profile', id: 'missing-profile' } },
      });
    }),
  );

  it.effect('reads the retained ring of another host by its state directory, without starting it', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const state = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'tagma-test-host-ring-' });
      const record = {
        id: 'test-host-vital',
        kind: 'vital',
        instanceId: 'test-host',
        wallTime: 1,
        monotonicStart: 0,
        monotonicEnd: 1,
        payload: {
          cpu: { userMicros: 0, systemMicros: 0 },
          memory: { rssBytes: 1, heapTotalBytes: 1, heapUsedBytes: 1, externalBytes: 0, arrayBufferBytes: 0 },
          loopDelay: { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 },
        },
      } as const;
      yield* PerformanceStore.use((store) =>
        Effect.andThen(
          Effect.sync(() => store.submit({ record, byteSize: recordByteSize(record), retentionKey: 'test-host' })),
          store.flush,
        ),
      ).pipe(
        Effect.provide(
          performanceStoreLayer({
            path: join(state, PERFORMANCE_FILE),
            instanceId: 'test-host',
            maxPendingBytes: () => 64_000,
            maxStoredBytes: () => 1_000_000,
          }),
        ),
      );
      const response = yield* world.call('/api/op/read_host_performance', {
        method: 'POST',
        body: { type: 'vitals', limit: 1, state },
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ performance: { type: 'vitals', vitals: [{ instanceId: 'test-host' }] } });
    }),
  );
});
