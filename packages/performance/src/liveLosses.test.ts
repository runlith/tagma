import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as Scope from 'effect/Scope';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';

it.live('live losses remain readable beside a pending retained read and after store closure', () =>
  Effect.gen(function* () {
    const opened = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(
      performanceReportsLayer.pipe(
        Layer.provideMerge(
          performanceStoreLayer({
            path: ':memory:',
            instanceId: 'live-losses-test',
            maxStoredBytes: () => 8 * 1024 * 1024,
            maxPendingBytes: () => 64 * 1024,
          }),
        ),
      ),
      opened,
    );
    const store = Context.get(context, PerformanceStore);
    const reports = Context.get(context, PerformanceReports);
    store.submit({
      retentionKey: 'pending',
      byteSize: 256,
      record: {
        id: 'pending',
        kind: 'span',
        instanceId: 'live-losses-test',
        wallTime: 1,
        monotonicStart: 0,
        monotonicEnd: 1,
        traceId: 'pending',
        name: 'work',
        payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: {} },
      },
    });
    const retained = yield* Effect.forkChild(reports.read({ type: 'losses', limit: 1 }), { startImmediately: true });
    const answering = yield* Effect.forkChild(reports.read({ type: 'losses', source: 'live', limit: 1 }), { startImmediately: true });
    const answered = answering.pollUnsafe();
    expect(answered === undefined ? undefined : answered._tag).toBe('Success');
    if (answered === undefined || !Exit.isSuccess(answered)) return yield* Effect.die('the live read did not answer at once');
    const live = answered.value;
    if (live.type !== 'losses') return yield* Effect.die('expected live losses');
    expect(live.evidence._tag).toBe('process-memory');
    expect(live.retainedRange).toBeNull();
    expect(live.pressure.pendingRecords).toBeGreaterThan(0);
    expect(live.pressure.pendingRecords).toBe(store.diagnostics().pendingRecords);
    const persisted = yield* Fiber.join(retained);
    if (persisted.type !== 'losses') return yield* Effect.die('expected retained losses');
    expect(persisted.evidence._tag).toBe('retained-and-live');
    const peak = store.diagnostics().peakPendingBytes;
    const healthy = yield* reports.read({ type: 'losses', source: 'live', limit: 1 });
    if (healthy.type !== 'losses') return yield* Effect.die('expected live losses');
    expect(healthy.pressure.state).toBe('ready');
    expect(store.diagnostics().peakPendingBytes).toBe(peak);
    yield* store.flush;
    const saved = yield* reports.read({ type: 'slow', name: 'work', limit: 1 });
    if (saved.type !== 'slow') return yield* Effect.die('expected retained spans');
    expect(saved.spans.map((span) => span.id)).toEqual(['pending']);

    yield* Scope.close(opened, Exit.void);
    for (const query of [
      { type: 'losses', source: 'live', limit: 1 },
      { type: 'losses', limit: 1 },
    ] as const) {
      const closed = yield* reports.read(query);
      if (closed.type !== 'losses') return yield* Effect.die('expected live losses');
      expect(closed.evidence._tag).toBe('process-memory');
      expect(closed.pressure.state).toBe('unavailable');
      expect(closed.retainedRange).toBeNull();
    }
  }),
);
