import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import * as LoopStalls from './LoopStalls.js';
import { CpuProfiler, cpuProfilerLayer } from './CpuProfiler.js';
import type { PerformanceStoreOptions } from './store/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';

const CEILING_MS = 100;
const PULSE_MS = CEILING_MS / 4;
const BLOCK_MS = 300;
const WINDOW_MS = 60_000;
const CAUSED_MS = BLOCK_MS / 2;

it.live('a stall carries the profile of the window it happened in', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-cpu-profiler-');
    const path = join(directory, 'performance.sqlite');
    const result = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        const reports = yield* PerformanceReports;
        yield* Effect.sleep(PULSE_MS * 2);
        blockLoop(BLOCK_MS);
        yield* Effect.sleep(PULSE_MS * 4);
        yield* store.flush;
        const stalls = yield* reports.read({ type: 'stalls', limit: 20 });
        if (stalls.type !== 'stalls') return yield* Effect.die('unexpected report');
        const reading = stalls.stalls.find((row) => row.stall.payload.delayMs >= CAUSED_MS);
        if (reading === undefined) return yield* Effect.die('the block recorded no stall');
        const stall = reading.stall;
        const profileId = stall.payload.profileId;
        if (profileId === undefined) return yield* Effect.die('the stall named no profile');
        const profile = yield* reports.read({ type: 'profile', id: profileId });
        if (profile.type !== 'profile') return yield* Effect.die('unexpected report');
        return { stall, profile: profile.profile, frame: reading.sampling?.frame };
      }),
    ).pipe(
      Effect.provide(LoopStalls.layer({ instanceId: 'process', ceilingMs: CEILING_MS })),
      Effect.provide(
        performanceReportsLayer.pipe(
          Layer.provideMerge(cpuProfilerLayer({ instanceId: 'process', stallCeilingMs: CEILING_MS, windowMs: () => WINDOW_MS })),
          Layer.provideMerge(performanceStoreLayer(storeOptions(path))),
        ),
      ),
    );

    expect(result.profile.monotonicStart).toBeLessThanOrEqual(result.stall.monotonicStart);
    expect(result.profile.monotonicEnd).toBeGreaterThanOrEqual(result.stall.monotonicEnd);
    expect(result.profile.payload.requestedBy).toBe('stall');
    expect(result.frame?.functionName).toBe('blockLoop');
    expect(result.frame?.selfMs ?? 0).toBeGreaterThan(0);
    expect(result.profile.payload.requestedDurationMs).toBeGreaterThanOrEqual(BLOCK_MS);
  }),
);

it.live('a standing window the process spent busy is kept as busy, and a quiet one is not', () =>
  Effect.gen(function* () {
    let burning: number | null = null;
    let spent = 0;
    const directory = yield* scratchDirectory('performance-cpu-busy-');
    const path = join(directory, 'performance.sqlite');
    const result = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        const reports = yield* PerformanceReports;
        yield* Effect.sleep(100);
        const quietFrom = performance.now();
        yield* Effect.sleep(100);
        yield* Effect.sleep(100);
        const burnFrom = performance.now();
        burning = burnFrom;
        while (performance.now() - burnFrom < 300) {
          burnLoop(10);
          yield* Effect.sleep(1);
        }
        spent += performance.now() - burnFrom;
        burning = null;
        yield* Effect.sleep(100);
        yield* store.flush;
        const listed = yield* reports.read({ type: 'profiles', limit: 20 });
        if (listed.type !== 'profiles') return yield* Effect.die('unexpected report');
        const kept = listed.profiles.find((profile) => profile.monotonicEnd > burnFrom);
        if (kept === undefined) return { quietFrom, burnFrom, profiles: listed.profiles, frames: [] };
        const read = yield* reports.read({ type: 'profile', id: kept.id, limit: 50 });
        if (read.type !== 'profile') return yield* Effect.die('unexpected report');
        return { quietFrom, burnFrom, profiles: listed.profiles, frames: read.frames.map((frame) => frame.functionName) };
      }),
    ).pipe(
      Effect.provide(
        performanceReportsLayer.pipe(
          Layer.provideMerge(
            cpuProfilerLayer({
              instanceId: 'process',
              stallCeilingMs: CEILING_MS,
              windowMs: () => 60,
              cpuUsage: (previous) => {
                const total = (spent + (burning === null ? 0 : performance.now() - burning)) * 1_000;
                return { user: total - (previous?.user ?? 0), system: 0 };
              },
              busy: { cpuShare: 0.5, everyMs: 0 },
            }),
          ),
          Layer.provideMerge(performanceStoreLayer(storeOptions(path))),
        ),
      ),
    );

    expect(result.profiles.every((profile) => profile.requestedBy === 'busy')).toBe(true);
    expect(
      result.profiles.filter((profile) => profile.monotonicStart >= result.quietFrom && profile.monotonicEnd <= result.burnFrom),
    ).toEqual([]);
    expect(result.frames).toContain('burnLoop');
  }),
);

it.live('without a standing sampler a manual capture still profiles its window, and the sampler stops after it', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-cpu-manual-');
    const path = join(directory, 'performance.sqlite');
    const result = yield* Effect.gen(function* () {
      const profiler = yield* CpuProfiler;
      const reports = yield* PerformanceReports;
      const before = profiler.running();
      const capture = yield* Effect.forkChild(profiler.window({ requestedBy: 'manual', requestedDurationMs: 300 }), {
        startImmediately: true,
      });
      yield* Effect.sleep(50);
      burnLoop(150);
      const captured = yield* Fiber.join(capture);
      if (captured === null) return { before, captured: false, after: profiler.running(), frames: [] as string[] };
      const read = yield* reports.read({ type: 'profile', id: captured.record.id, limit: 50 });
      if (read.type !== 'profile') return yield* Effect.die('unexpected report');
      return { before, captured: true, after: profiler.running(), frames: read.frames.map((frame) => frame.functionName) };
    }).pipe(
      Effect.provide(
        performanceReportsLayer.pipe(
          Layer.provideMerge(cpuProfilerLayer({ instanceId: 'process', stallCeilingMs: CEILING_MS, windowMs: () => 0 })),
          Layer.provideMerge(performanceStoreLayer(storeOptions(path))),
        ),
      ),
    );

    expect(result).toMatchObject({ before: false, captured: true, after: false });
    expect(result.frames).toContain('burnLoop');
  }),
);

function burnLoop(milliseconds: number): void {
  const started = performance.now();
  while (performance.now() - started < milliseconds) {}
}

function blockLoop(milliseconds: number): void {
  const started = performance.now();
  while (performance.now() - started < milliseconds) {}
}

function storeOptions(path: string): PerformanceStoreOptions {
  return { path, instanceId: 'process', maxPendingBytes: () => 8_000_000, maxStoredBytes: () => 64_000_000 };
}
