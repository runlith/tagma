import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { declare } from '@runlith/held/Held';
import { randomUUID } from 'node:crypto';
import type { CpuProfileOperation, CpuProfileRequest } from './CpuProfile.js';
import { type CpuCapture, CpuProfiler } from './CpuProfiler.js';
import { PerformanceStore } from './store/store.js';
import { PerformanceStoreUnavailable, type PerformanceRecordFailure } from './store/records.js';

export type CpuProfilesDiagnostics = {
  readonly active: null | {
    readonly id: string;
    readonly requestedBy: string;
    readonly requestedDurationMs: number;
    readonly startedAt: number;
  };
  readonly pending: number;
};

export class CpuProfileFailed extends Data.TaggedError('CpuProfileFailed')<{
  readonly operation: CpuProfileOperation;
  readonly message: string;
}> {}

export type CpuProfileFailure = CpuProfileFailed | PerformanceStoreUnavailable | PerformanceRecordFailure;

export class CpuProfiles extends Context.Service<
  CpuProfiles,
  {
    readonly capture: (request: CpuProfileRequest) => Effect.Effect<CpuCapture, CpuProfileFailure>;
    readonly diagnostics: () => CpuProfilesDiagnostics;
  }
>()('@runlith/performance/CpuProfiles') {}

export const cpuProfilesLayer = () => Layer.effect(CpuProfiles, make());

const make = Effect.fnUntraced(function* () {
  const store = yield* PerformanceStore;
  const profiler = yield* CpuProfiler;
  const gate = declare<string>({
    name: 'cpu-profiles',
    owner: 'performance',
    rank: 720,
    key: (key: string) => key,
    concurrency: 1,
    threshold: Duration.minutes(6),
    ceilings: {
      hold: Duration.minutes(6),
      wait: Duration.minutes(15),
      leaves: 'the capture may have opened a window or submitted samples; inspect the returned profile before retrying',
    },
    external: { named: 'CPU inspector', callsBack: false },
  });
  const pending = new Set<string>();
  let active: CpuProfilesDiagnostics['active'] = null;

  const capture = (request: CpuProfileRequest) =>
    Effect.suspend(() => {
      const id = randomUUID();
      pending.add(id);
      return gate
        .hold(
          'sole',
          Effect.gen(function* () {
            pending.delete(id);
            active = { id, ...request, startedAt: yield* Clock.currentTimeMillis };
            const before = store.diagnostics();
            if (before.state === 'unavailable') {
              return yield* new PerformanceStoreUnavailable({
                message: before.lastError ?? 'performance store is unavailable',
              });
            }
            const captured = yield* profiler.window(request);
            if (captured === null) {
              return yield* new CpuProfileFailed({ operation: 'start', message: 'the process runs no profiler' });
            }
            const after = store.diagnostics();
            if (after.state === 'unavailable') {
              return yield* new PerformanceStoreUnavailable({
                message: after.lastError ?? 'performance store is unavailable',
              });
            }
            return captured;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                active = null;
              }),
            ),
          ),
        )
        .pipe(
          Effect.catchTag('HoldStalled', (stall) =>
            Effect.fail(
              new CpuProfileFailed({
                operation: 'start',
                message: `the capture waited ${stall.waitedMs} ms for the capture door`,
              }),
            ),
          ),
          Effect.catchTag('HoldCut', (cut) =>
            Effect.fail(
              new CpuProfileFailed({
                operation: 'start',
                message: `the capture held the capture door ${cut.heldMs} ms; ${cut.leaves}`,
              }),
            ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              pending.delete(id);
            }),
          ),
          Effect.withTracerEnabled(false),
        );
    });

  return CpuProfiles.of({
    capture,
    diagnostics: () => ({ active, pending: pending.size }),
  });
});
