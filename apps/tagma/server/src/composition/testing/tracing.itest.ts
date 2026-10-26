import { expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { PerformanceStore } from '@runlith/performance/PerformanceStore';
import { Context, Effect, Layer } from 'effect';
import { DoorFixture, doorFixture, makeDoorWorld } from './doorFixture.js';
import { rootFixture, tempRepoEffect } from './graphFixture.js';
import { Settings } from '../../settings/contract/service/values.js';
import { performanceKeepOneTraceIn } from '../../performance/contract/wire/settings.js';

type TracedWorld = Effect.Success<ReturnType<typeof makeDoorWorld>>;

const keepEveryTrace = Effect.fnUntraced(function* (world: TracedWorld) {
  const settings = Context.get(world.runtime.graph, Settings);
  const previous = (yield* settings.read(performanceKeepOneTraceIn)).layers.user;
  yield* Effect.acquireRelease(settings.write({ scope: 'user', key: performanceKeepOneTraceIn.id, value: 1 }), () =>
    settings
      .write({
        scope: 'user',
        key: performanceKeepOneTraceIn.id,
        value: previous?.value,
        declined: previous?.declined,
      })
      .pipe(Effect.orDie),
  );
});

const traceOf = (world: TracedWorld, traceId: string) =>
  Effect.flatMap(world.runtime.runtime.contextEffect, (context) =>
    Effect.provide(
      Effect.gen(function* () {
        yield* Effect.yieldNow;
        const store = yield* PerformanceStore;
        yield* store.flush;
        return yield* (yield* PerformanceReports).read({ type: 'trace', traceId, limit: 100 });
      }),
      context,
    ),
  );

layer(doorFixture({ everySpan: true }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 30_000,
  timeout: 60_000,
})('door tracing', (it) => {
  it.effect('the HTTP door continues a W3C parent into the persisted server span', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const traceId = randomUUID().replaceAll('-', '');
      const parentId = randomUUID().replaceAll('-', '').slice(0, 16);

      yield* keepEveryTrace(world);
      const response = yield* Effect.promise(() =>
        world.app(
          new Request('http://tagma/health', {
            headers: { traceparent: `00-${traceId}-${parentId}-01` },
          }),
          world.routed,
        ),
      );
      expect(response.status).toBe(200);

      const report = yield* traceOf(world, traceId);
      expect(report.type).toBe('trace');
      if (report.type !== 'trace') return;
      expect(report.segments).toHaveLength(1);
      expect(report.segments[0]?.rootIds).toHaveLength(1);
      const spans = report.segments[0]?.spans ?? [];
      expect(spans.filter((span) => span.parentId === parentId)).toEqual([
        expect.objectContaining({
          traceId,
          name: 'http.server GET',
          payload: expect.objectContaining({ spanKind: 'server' }),
        }),
      ]);
    }),
  );

  it.effect(
    'one cwd request discovers its repository once across routing and response projection',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const traceId = randomUUID().replaceAll('-', '');
        const parentId = randomUUID().replaceAll('-', '').slice(0, 16);
        const checkouts = yield* Effect.acquireRelease(Effect.sync(rootFixture), (roots) => Effect.orDie(roots.releaseEffect));
        const repo = yield* tempRepoEffect(yield* checkouts.openEffect, 'tagma-door-checkout-');

        yield* keepEveryTrace(world);
        const created = yield* world.call('/api/op/add_project', {
          method: 'POST',
          body: { name: world.uniqueName(), rootPath: repo, storage: 'stealth' },
        });
        expect(created.status).toBe(200);
        const response = yield* Effect.promise(() =>
          world.app(
            new Request(`http://tagma/api/op/read_project?cwd=${encodeURIComponent(repo)}`, {
              method: 'POST',
              headers: { traceparent: `00-${traceId}-${parentId}-01`, 'content-type': 'application/json' },
              body: '{}',
            }),
            world.routed,
          ),
        );
        expect(response.status).toBe(200);

        const report = yield* traceOf(world, traceId);
        expect(report.type).toBe('trace');
        if (report.type !== 'trace') return;
        const spans = report.segments.flatMap((segment) => segment.spans);
        expect(spans.filter((span) => span.name === 'Repo.locate')).toHaveLength(1);
      }),
    10_000,
  );
});
