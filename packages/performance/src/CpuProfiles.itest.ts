import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as Scope from 'effect/Scope';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import { TestClock } from 'effect/testing';
import { cpuProfileArtifactSchema, type CpuProfileRequest } from './CpuProfile.js';
import { CpuProfiles, cpuProfilesLayer } from './CpuProfiles.js';
import { PerformanceRecordRefused, PerformanceStoreUnavailable, type PerformanceStoreOptions } from './store/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { CpuProfiler, cpuProfilerLayer } from './CpuProfiler.js';

it.effect('capture persists sampled work and durable cuts across standing windows', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-cpu-profile-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const profiles = yield* CpuProfiles;
      const reports = yield* PerformanceReports;
      const profiler = yield* CpuProfiler;
      const clock = yield* Clock.Clock;
      const capturing = yield* startCapture(profiles, { requestedBy: 'busy-control', requestedDurationMs: 600 });
      yield* capturing.started;
      yield* TestClock.adjust(Duration.micros(250n));
      const early = yield* profiler.cut('stall').pipe(
        Effect.provideService(Clock.Clock, {
          ...clock,
          currentTimeMillis: Effect.map(clock.currentTimeMillis, Math.floor),
          currentTimeMillisUnsafe: () => Math.floor(clock.currentTimeMillisUnsafe()),
        }),
      );
      if (early === null) return yield* Effect.die('the early cut kept no profile');
      yield* TestClock.adjust(299.75);
      const cut = yield* profiler.cut('stall');
      if (cut === null) return yield* Effect.die('the cut kept no profile');
      measuredStringify({ text: 'x'.repeat(8 * 1024 * 1024) }, 250);
      yield* TestClock.adjust(300);
      const { record, cuts } = yield* Fiber.join(capturing.fiber);
      expect(cuts).toEqual([
        { id: early.id, requestedBy: 'stall' },
        { id: cut.id, requestedBy: 'stall' },
      ]);
      expect(early.monotonicEnd - early.monotonicStart).toBe(0.25);
      expect(early.payload.requestedDurationMs).toBe(0);
      const first = yield* reports.read({ type: 'profile', id: cuts[0]!.id, raw: true, limit: 1 });
      if (first.type !== 'profile' || first.profile.payload.profile === undefined)
        return yield* Effect.die('the early cut has no raw profile');
      expect(first.profile.id).toBe(early.id);
      expect(first.profile.payload.requestedDurationMs).toBe(0);
      yield* decodeArtifact(first.profile.payload.profile);
      const held = yield* reports.read({ type: 'profile', id: cut.id });
      if (held.type !== 'profile') return yield* Effect.die('the cut named no stored profile');
      expect(held.profile.monotonicEnd).toBeLessThanOrEqual(record.monotonicStart);
      expect(record.monotonicEnd - first.profile.monotonicStart).toBeGreaterThanOrEqual(600);
      expect(record.payload.requestedDurationMs).toBe(600);

      const point = yield* reports.read({ type: 'profile', id: record.id, raw: true });
      if (point.type !== 'profile') return yield* Effect.die('unexpected report');
      const raw = point.profile.payload.profile;
      if (raw === undefined) return yield* Effect.die('raw profile missing');
      const artifact = yield* decodeArtifact(raw);
      const counts = new Map<number, number>();
      for (const id of artifact.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
      const top = artifact.nodes
        .map((node) => ({ functionName: node.callFrame.functionName, samples: counts.get(node.id) ?? 0 }))
        .sort((left, right) => right.samples - left.samples)[0];

      expect(top?.functionName).toBe('stringify');
      expect(top?.samples).toBeGreaterThan(0);
      expect(artifact.samples).toHaveLength(artifact.timeDeltas.length);
      expect(record.monotonicEnd - record.monotonicStart).toBeGreaterThanOrEqual(300);

      const idleCapture = yield* startCapture(profiles, { requestedBy: 'idle-control', requestedDurationMs: 100 });
      yield* idleCapture.started;
      yield* TestClock.adjust(100);
      const { record: idle, cuts: idleCuts } = yield* Fiber.join(idleCapture.fiber);
      expect(idleCuts).toEqual([]);
      expect(idle.monotonicEnd - idle.monotonicStart).toBeGreaterThanOrEqual(100);
      const idlePoint = yield* reports.read({ type: 'profile', id: idle.id, raw: true });
      if (idlePoint.type !== 'profile') return yield* Effect.die('unexpected report');
      const idleRaw = idlePoint.profile.payload.profile;
      if (idleRaw === undefined) return yield* Effect.die('raw profile missing');
      const idleArtifact = yield* decodeArtifact(idleRaw);
      expect(idleArtifact.nodes.map((node) => node.callFrame.functionName)).not.toContain('stringify');

      const list = yield* reports.read({ type: 'profiles', limit: 10 });
      if (list.type !== 'profiles') return yield* Effect.die('unexpected report');
      expect(list.profiles.map((profile) => profile.requestedBy)).toEqual(['stall', 'stall', 'busy-control', 'idle-control']);
      expect(list.profiles.find((profile) => profile.id === early.id)?.requestedDurationMs).toBe(0);
    }).pipe(Effect.provide(cpuLayer(storeOptions(path), 40)));
  }),
);

it.effect('captures serialize and interruption releases the capture door', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-cpu-profile-lifecycle-');
    const path = join(directory, 'performance.sqlite');
    yield* CpuProfiles.use((profiles) =>
      Effect.gen(function* () {
        const firstCapture = yield* startCapture(profiles, { requestedBy: 'first', requestedDurationMs: 80 });
        yield* firstCapture.started;
        const secondCapture = yield* startCapture(profiles, { requestedBy: 'second', requestedDurationMs: 30 });
        expect(profiles.diagnostics().active?.requestedBy).toBe('first');
        expect(profiles.diagnostics().pending).toBe(1);

        yield* TestClock.adjust(80);
        const { record: first } = yield* Fiber.join(firstCapture.fiber);
        yield* secondCapture.started;
        yield* TestClock.adjust(30);
        const { record: second } = yield* Fiber.join(secondCapture.fiber);
        expect(second.monotonicStart).toBeGreaterThanOrEqual(first.monotonicEnd);
        expect(profiles.diagnostics()).toEqual({ active: null, pending: 0 });

        const interrupted = yield* startCapture(profiles, { requestedBy: 'interrupted', requestedDurationMs: 1_000 });
        yield* interrupted.started;
        yield* Fiber.interrupt(interrupted.fiber);
        expect(profiles.diagnostics()).toEqual({ active: null, pending: 0 });

        const recovering = yield* startCapture(profiles, { requestedBy: 'recovered', requestedDurationMs: 20 });
        yield* recovering.started;
        yield* TestClock.adjust(20);
        const recovered = yield* Fiber.join(recovering.fiber);
        expect(recovered.record.payload.requestedBy).toBe('recovered');
      }),
    ).pipe(Effect.provide(cpuLayer(storeOptions(path))));
  }),
);

it.effect('a manual capture whose store refuses durability never answers as a kept profile', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-cpu-profile-refused-');
    const path = join(directory, 'performance.sqlite');
    const refusing = Layer.effect(
      PerformanceStore,
      Effect.map(PerformanceStore, (store) =>
        PerformanceStore.of({
          ...store,
          submitDurable: () =>
            Effect.fail(
              new PerformanceRecordRefused({ reason: 'pending-limit', message: 'the pending buffer was dropped before acknowledgement' }),
            ),
        }),
      ),
    ).pipe(Layer.provideMerge(performanceStoreLayer(storeOptions(path))));
    const profiler = cpuProfilerLayer({ instanceId: 'process', stallCeilingMs: 100, windowMs: () => 10_000 });
    const layer = cpuProfilesLayer().pipe(Layer.provideMerge(profiler), Layer.provideMerge(refusing));
    const refused = yield* CpuProfiles.use((profiles) =>
      Effect.gen(function* () {
        const capture = yield* startCapture(profiles, { requestedBy: 'bounded', requestedDurationMs: 20 });
        yield* capture.started;
        yield* TestClock.adjust(20);
        const failure = yield* Effect.flip(Fiber.join(capture.fiber));
        expect(profiles.diagnostics()).toEqual({ active: null, pending: 0 });
        return failure;
      }),
    ).pipe(Effect.provide(layer));
    expect(refused).toMatchObject({ _tag: 'PerformanceRecordRefused', reason: 'pending-limit' });
  }),
);

it.effect('capture refuses after the bound performance store scope closes', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-cpu-profile-unavailable-');
    const path = join(directory, 'performance.sqlite');
    const opened = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(cpuLayer(storeOptions(path)), opened);
    const profiles = Context.get(context, CpuProfiles);
    yield* Scope.close(opened, Exit.void);
    const failure = yield* Effect.flip(profiles.capture({ requestedBy: 'after-close', requestedDurationMs: 20 }));
    expect(failure).toBeInstanceOf(PerformanceStoreUnavailable);
  }),
);

const decodeArtifact = Schema.decodeUnknownEffect(cpuProfileArtifactSchema);

const startCapture = Effect.fnUntraced(function* (profiles: CpuProfiles['Service'], request: CpuProfileRequest) {
  const clock = yield* Clock.Clock;
  const started = yield* Deferred.make<void>();
  const fiber = yield* Effect.forkChild(
    profiles.capture(request).pipe(
      Effect.provideService(Clock.Clock, {
        ...clock,
        sleep: (duration) =>
          Duration.toMillis(duration) === request.requestedDurationMs
            ? Deferred.succeed(started, undefined).pipe(Effect.andThen(clock.sleep(duration)))
            : clock.sleep(duration),
      }),
    ),
    { startImmediately: true },
  );
  return { fiber, started: Deferred.await(started) };
});

function cpuLayer(options: PerformanceStoreOptions, windowMs = 10_000) {
  const performance = performanceReportsLayer.pipe(Layer.provideMerge(performanceStoreLayer(options)));
  const profiler = cpuProfilerLayer({ instanceId: 'process', stallCeilingMs: 100, windowMs: () => windowMs });
  return cpuProfilesLayer().pipe(Layer.provideMerge(profiler), Layer.provideMerge(performance));
}

function storeOptions(path: string): PerformanceStoreOptions {
  return { path, instanceId: 'process', maxPendingBytes: () => 10_000_000, maxStoredBytes: () => 100_000_000 };
}

function measuredStringify(value: unknown, durationMs: number): void {
  const until = performance.now() + durationMs;
  while (performance.now() < until) JSON.stringify(value);
}
