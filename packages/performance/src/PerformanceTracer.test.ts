import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Cause from 'effect/Cause';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Metric from 'effect/Metric';
import * as Option from 'effect/Option';
import * as Tracer from 'effect/Tracer';
import type { PerformanceRecord } from './store/records.js';
import * as PerformanceTracer from './PerformanceTracer.js';
import { PerformanceStore } from './store/store.js';
import { CurrentTraceSampler, TraceSampler, type SampledSpan } from './TraceSampler.js';

const NEVER_BY_HASH = () => 1_000_000_000;
const MS = 1_000_000n;

it.effect(
  "a span opened as a judged unit keeps its own subtree when it runs past its name's p99, and a unit under the root's ceiling is not slow",
  () =>
    Effect.gen(function* () {
      let clockMs = 0;
      const stored: string[] = [];
      const tracer = yield* PerformanceTracer.make({
        instanceId: 'process',
        recordFloorMicros: 0,
        keepOneTraceIn: NEVER_BY_HASH,
        units: new Set(['agent.tool-call']),
      }).pipe(
        Effect.provideService(PerformanceStore, capturing(stored)),
        Effect.provideService(CurrentTraceSampler, new TraceSampler(() => clockMs)),
        Effect.provideService(Metric.MetricRegistry, new Map()),
      );

      const run = open(tracer, 'agent.run', 0n);
      for (let index = 0; index < 100; index += 1) {
        const start = BigInt(index) * 1_000n * MS;
        const usual = open(tracer, 'agent.tool-call', start, run);
        open(tracer, 'usual.read', start, usual).end(start + 10n * MS, Exit.void);
        clockMs = index * 1_000 + 400;
        usual.end(start + 400n * MS, Exit.void);
      }
      const start = 200_000n * MS;
      const slow = open(tracer, 'agent.tool-call', start, run);
      const wait = open(tracer, 'slow.wait', start, slow);
      const read = open(tracer, 'slow.read', start + 83_000n * MS, slow);
      clockMs = 283_000;
      wait.end(start + 83_000n * MS, Exit.void);
      clockMs = 286_000;
      read.end(start + 86_000n * MS, Exit.void);
      slow.end(start + 86_000n * MS, Exit.void);

      expect(stored.sort()).toEqual(['agent.tool-call', 'slow.read', 'slow.wait']);
    }),
);

it.effect('a span whose name the product declares a unit is judged against its own name, not the slower tool call around it', () =>
  Effect.gen(function* () {
    let clockMs = 0;
    const stored: string[] = [];
    const tracer = yield* PerformanceTracer.make({
      instanceId: 'process',
      recordFloorMicros: 0,
      keepOneTraceIn: NEVER_BY_HASH,
      units: new Set(['agent.tool-call', 'delete_thread']),
    }).pipe(
      Effect.provideService(PerformanceStore, capturing(stored)),
      Effect.provideService(CurrentTraceSampler, new TraceSampler(() => clockMs)),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    );

    const run = open(tracer, 'agent.run', 0n);
    for (let index = 0; index < 100; index += 1) {
      const start = BigInt(index) * 100_000n * MS;
      const call = open(tracer, 'agent.tool-call', start, run);
      const usual = open(tracer, 'delete_thread', start, call);
      open(tracer, 'usual.delete', start, usual).end(start + 5n * MS, Exit.void);
      usual.end(start + 10n * MS, Exit.void);
      clockMs = index * 100_000 + 90_000;
      call.end(start + 90_000n * MS, Exit.void);
    }
    const start = 20_000_000n * MS;
    const call = open(tracer, 'agent.tool-call', start, run);
    const slow = open(tracer, 'delete_thread', start, call);
    const stop = open(tracer, 'slow.stop', start, slow);
    clockMs = 20_006_000;
    stop.end(start + 6_000n * MS, Exit.void);
    slow.end(start + 6_000n * MS, Exit.void);
    call.end(start + 6_000n * MS, Exit.void);

    expect(stored.sort()).toEqual(['delete_thread', 'slow.stop']);
  }),
);

it.effect('the sampling boundary holds only exit reasons and projected primitive attributes', () =>
  Effect.gen(function* () {
    const retained: SampledSpan[] = [];
    class ReadingSampler extends TraceSampler {
      override end(span: SampledSpan): void {
        retained.push(span);
        super.end(span);
      }
    }
    const tracer = yield* PerformanceTracer.make({ instanceId: 'process', recordFloorMicros: 0 }).pipe(
      Effect.provideService(PerformanceStore, capturing([])),
      Effect.provideService(CurrentTraceSampler, new ReadingSampler()),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    );
    const root = open(tracer, 'run', 0n);
    const payload = { rows: new Uint8Array(1024) };
    const success = open(tracer, 'sql.execute', 0n, root);
    success.attribute('rows', payload);
    success.attribute('db.query.fingerprint', 'cafe');
    success.attribute('db.queue.ms', 3);
    success.attribute('db.exec.ms', 7);
    success.end(MS, Exit.succeed(payload));
    open(tracer, 'failed', 0n, root).end(MS, Exit.fail(payload));
    success.attribute('db.exec.ms', 100);
    expect(retained.map((span) => span.exit)).toEqual([{ _tag: 'Success' }, { _tag: 'Failure', reasons: ['Fail'] }]);
    expect(retained[0]?.attributes).toEqual({ 'db.query.fingerprint': 'cafe', 'db.queue.ms': 3, 'db.exec.ms': 7 });
    root.end(MS, Exit.void);
  }),
);

it.effect('an ended span keeps its outcome, not the value its work answered, so a span still referenced holds no result alive', () =>
  Effect.gen(function* () {
    const tracer = yield* PerformanceTracer.make({ instanceId: 'process', recordFloorMicros: 0 }).pipe(
      Effect.provideService(PerformanceStore, capturing([])),
      Effect.provideService(CurrentTraceSampler, new TraceSampler()),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    );
    const root = open(tracer, 'run', 0n);
    const answered = open(tracer, 'agent.run', 0n, root);
    answered.end(MS, Exit.succeed({ catalog: new Uint8Array(1024) }));
    const failed = open(tracer, 'failed', 0n, root);
    failed.end(MS, Exit.fail('refused'));
    root.end(MS, Exit.void);

    expect(answered.status).toMatchObject({ _tag: 'Ended', exit: Exit.void });
    expect(failed.status._tag === 'Ended' && Exit.isFailure(failed.status.exit)).toBe(true);
  }),
);

it.live('nested Effect spans submit their timed tree, projected attributes and failure outcome', () =>
  Effect.gen(function* () {
    const records: PerformanceRecord[] = [];
    const store = capturing([], records);
    const tracer = yield* PerformanceTracer.make({ instanceId: 'process', recordFloorMicros: 0, keepOneTraceIn: () => 1 }).pipe(
      Effect.provideService(PerformanceStore, store),
      Effect.provideService(CurrentTraceSampler, new TraceSampler()),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    );
    yield* Effect.fail('refused').pipe(
      Effect.withSpan('child', { attributes: { fold: 'entries' } }),
      Effect.result,
      Effect.withSpan('parent', { attributes: { fold: 'history', 'checkout.root': 'root', 'checkout.path': '/checkout' } }),
      Effect.withTracer(tracer),
    );
    const parent = records.find((record) => record.name === 'parent');
    const child = records.find((record) => record.name === 'child');
    expect(records).toHaveLength(2);
    expect(child?.parentId).toBe(parent?.id);
    expect(child?.traceId).toBe(parent?.traceId);
    expect(parent?.monotonicStart).toBeLessThanOrEqual(child?.monotonicStart ?? -1);
    expect(child?.monotonicEnd).toBeLessThanOrEqual(parent?.monotonicEnd ?? -1);
    expect(parent?.payload).toMatchObject({
      exit: { _tag: 'Success' },
      attributes: { 'thread.fold': 'history', 'checkout.root': 'root', 'checkout.path': '/checkout' },
    });
    expect(child?.payload).toMatchObject({ exit: { _tag: 'Failure', reasons: ['Fail'] }, attributes: { 'thread.fold': 'entries' } });
    expect(store.diagnostics().activeGroups).toBe(0);
  }),
);

it.effect('interruption is timed without a failure count, mixed failure is counted, and disabled spans still update metrics', () =>
  Effect.gen(function* () {
    const records: PerformanceRecord[] = [];
    const registry = new Map();
    const tracer = yield* PerformanceTracer.make({ instanceId: 'process', recordFloorMicros: 0, keepOneTraceIn: () => 1 }).pipe(
      Effect.provideService(PerformanceStore, capturing([], records)),
      Effect.provideService(CurrentTraceSampler, new TraceSampler()),
      Effect.provideService(Metric.MetricRegistry, registry),
    );
    open(tracer, 'subscribe', 0n).end(MS, Exit.interrupt(1));
    open(tracer, 'write', 0n).end(MS, Exit.failCause(Cause.fromReasons([Cause.makeFailReason('refused'), Cause.makeInterruptReason(1)])));
    yield* Effect.fail('refused').pipe(Effect.withSpan('sampled-off', { sampled: false }), Effect.result, Effect.withTracer(tracer));
    yield* Effect.void.pipe(
      Effect.withSpan('below-level', { level: 'Trace' }),
      Effect.provideService(Tracer.MinimumTraceLevel, 'Info'),
      Effect.withTracer(tracer),
    );
    const metrics = yield* Metric.snapshot.pipe(Effect.provideService(Metric.MetricRegistry, registry));
    const failures = (name: string) => metrics.find((metric) => metric.id === name && metric.type === 'Counter');
    expect(failures('subscribe')).toBeUndefined();
    expect(failures('write')?.state).toMatchObject({ count: 1 });
    expect(failures('sampled-off')?.state).toMatchObject({ count: 1 });
    for (const name of ['subscribe', 'write', 'sampled-off', 'below-level']) {
      expect(metrics.find((metric) => metric.id === name && metric.type === 'Histogram')?.state).toMatchObject({ count: 1 });
    }
    expect(records.map((record) => record.name).sort()).toEqual(['subscribe', 'write']);
    expect(records.find((record) => record.name === 'subscribe')?.payload).toMatchObject({
      exit: { _tag: 'Failure', reasons: ['Interrupt'] },
    });
  }),
);

it.effect('the floor applies to hash-kept successes while a failure or slow root keeps its short children', () =>
  Effect.gen(function* () {
    const records: PerformanceRecord[] = [];
    const registry = new Map();
    const tracer = yield* PerformanceTracer.make({ instanceId: 'process', recordFloorMicros: 15, keepOneTraceIn: () => 1 }).pipe(
      Effect.provideService(PerformanceStore, capturing([], records)),
      Effect.provideService(CurrentTraceSampler, new TraceSampler()),
      Effect.provideService(Metric.MetricRegistry, registry),
    );
    open(tracer, 'below.floor', 0n).end(5_000n, Exit.void);
    open(tracer, 'below.floor.failed', 0n).end(5_000n, Exit.fail('refused'));
    open(tracer, 'above.floor', 0n).end(50_000n, Exit.void);
    const root = open(tracer, 'slow.root', 0n);
    open(tracer, 'under.slow.root', 0n, root).end(5_000n, Exit.void);
    root.end(300n * MS, Exit.void);
    expect(records.map((record) => record.name).sort()).toEqual(['above.floor', 'below.floor.failed', 'slow.root', 'under.slow.root']);
    const metrics = yield* Metric.snapshot.pipe(Effect.provideService(Metric.MetricRegistry, registry));
    expect(metrics.find((metric) => metric.id === 'below.floor' && metric.type === 'Histogram')?.state).toMatchObject({ count: 1 });
  }),
);

it.effect('a failed trace keeps its subtree while a kept external trace retains a child that outlives its parent', () =>
  Effect.gen(function* () {
    const records: PerformanceRecord[] = [];
    const store = capturing([], records);
    const boot = (keepOneTraceIn: () => number) =>
      PerformanceTracer.make({ instanceId: 'process', recordFloorMicros: 0, keepOneTraceIn }).pipe(
        Effect.provideService(PerformanceStore, store),
        Effect.provideService(CurrentTraceSampler, new TraceSampler()),
        Effect.provideService(Metric.MetricRegistry, new Map()),
      );
    const tracer = yield* boot(NEVER_BY_HASH);
    const parent = open(tracer, 'request', 0n);
    open(tracer, 'lookup', 0n, parent).end(MS, Exit.void);
    open(tracer, 'write', 0n, parent).end(2n * MS, Exit.fail('refused'));
    parent.end(3n * MS, Exit.void);
    open(tracer, 'quiet', 0n).end(MS, Exit.void);
    expect(records.map((record) => record.name).sort()).toEqual(['lookup', 'request', 'write']);
    records.length = 0;
    const kept = yield* boot(() => 1);
    const external = Tracer.externalSpan({ spanId: 'outside', traceId: 'external-trace' });
    const before = open(kept, 'parent', 0n, external);
    const after = open(kept, 'late', 0n, before);
    before.end(MS, Exit.void);
    after.end(2n * MS, Exit.void);
    expect(records.map((record) => record.name).sort()).toEqual(['late', 'parent']);
    expect(records.every((record) => record.traceId === 'external-trace')).toBe(true);
    expect(store.diagnostics().activeGroups).toBe(0);
  }),
);

it.effect('a root is slow at its absolute ceiling until its name settles, then only beyond its own p99', () =>
  Effect.gen(function* () {
    const records: PerformanceRecord[] = [];
    const tracer = yield* PerformanceTracer.make({ instanceId: 'process', recordFloorMicros: 0, keepOneTraceIn: NEVER_BY_HASH }).pipe(
      Effect.provideService(PerformanceStore, capturing([], records)),
      Effect.provideService(CurrentTraceSampler, new TraceSampler()),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    );
    open(tracer, 'first', 0n).end(300n * MS, Exit.void);
    open(tracer, 'first', 0n).end(200n * MS, Exit.void);
    for (let index = 0; index < 101; index += 1) open(tracer, 'steady', 0n).end(400n * MS, Exit.void);
    open(tracer, 'steady', 0n).end(2_000n * MS, Exit.void);
    expect(records.filter((record) => record.name === 'first')).toHaveLength(1);
    const steady = records.filter((record) => record.name === 'steady');
    expect(steady).toHaveLength(100);
    expect(steady.at(-1)!.monotonicEnd - steady.at(-1)!.monotonicStart).toBeCloseTo(2_000, 6);
  }),
);

function open(
  tracer: Tracer.Tracer,
  name: string,
  startTime: bigint,
  parent?: Tracer.AnySpan,
  annotations: Context.Context<never> = Context.empty(),
): Tracer.Span {
  return tracer.span({
    name,
    parent: parent === undefined ? Option.none() : Option.some(parent),
    annotations,
    links: [],
    startTime,
    kind: 'internal',
    root: parent === undefined,
    sampled: true,
  });
}

function capturing(stored: string[], retained: PerformanceRecord[] = []) {
  const groups = new Set<string>();
  return PerformanceStore.of({
    openGroup: (group) => void groups.add(group),
    closeGroup: (group) => void groups.delete(group),
    submit: (submission) => {
      retained.push(submission.record);
      if (submission.record.kind === 'span') stored.push((submission.record as { readonly name: string }).name);
    },
    submitDurable: () => Effect.void,
    readWorkerMemory: () => Effect.die('no worker'),
    flush: Effect.void,
    pressure: () => ({
      state: 'ready',
      pendingRecords: 0,
      pendingBytes: 0,
      peakPendingBytes: 0,
      persistedRecords: stored.length,
      droppedRecords: 0,
    }),
    diagnostics: () => ({
      state: 'ready',
      path: ':test:',
      restarts: 0,
      activeGroups: groups.size,
      pendingBytes: 0,
      pendingRecords: 0,
      peakPendingBytes: 0,
      dropCount: 0,
      maintenancePasses: 0,
      evictedSegments: 0,
      lastEvictionMs: null,
      uncertainRecords: 0,
      unrecorded: [],
      lastError: null,
    }),
  });
}
