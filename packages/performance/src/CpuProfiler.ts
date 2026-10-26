import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { declare } from '@runlith/held/Held';
import { Session } from 'node:inspector';
import { randomUUID } from 'node:crypto';
import { cpuProfileArtifactSchema, type CpuProfileRequest } from './CpuProfile.js';
import { monotonicMs } from './monotonic.js';
import type { StoredProfileRecord } from './protocol/records.js';
import { PerformanceStore } from './store/store.js';
import { recordByteSize, type PerformanceRecordFailure, type PerformanceSubmission } from './store/records.js';

export type Options = {
  readonly instanceId: string;
  readonly stallCeilingMs: number;
  readonly windowMs: () => number;
  readonly cpuUsage?: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  readonly busy?: {
    readonly cpuShare: number;
    readonly everyMs: number;
  };
};

export type ProfileCut = {
  readonly id: string;
  readonly requestedBy: string;
};

export type CpuCapture = {
  readonly record: StoredProfileRecord;
  readonly cuts: ReadonlyArray<ProfileCut>;
};

type CaptureWindow = { readonly cuts: ProfileCut[]; failure: PerformanceRecordFailure | null };

const submissionOf = (record: StoredProfileRecord): PerformanceSubmission => ({
  record,
  retentionKey: record.id,
  byteSize: recordByteSize(record),
});

export class CpuProfiler extends Context.Service<
  CpuProfiler,
  {
    readonly cut: (requestedBy: string) => Effect.Effect<StoredProfileRecord | null>;
    readonly window: (request: CpuProfileRequest) => Effect.Effect<CpuCapture | null, PerformanceRecordFailure>;
    readonly running: () => boolean;
  }
>()('@runlith/performance/CpuProfiler') {}

export const cpuProfilerLayer = (options: Options) => Layer.effect(CpuProfiler, make(options));

export const cpuProfilerNoneLayer = Layer.succeed(
  CpuProfiler,
  CpuProfiler.of({ cut: () => Effect.succeed(null), window: () => Effect.succeed(null), running: () => false }),
);

const profilerStopSchema = Schema.Struct({ profile: Schema.Json });

const SAMPLES_PER_CEILING = 100;

const make = Effect.fnUntraced(function* (options: Options) {
  const store = yield* PerformanceStore;
  const cpuUsage = options.cpuUsage ?? ((previous?: NodeJS.CpuUsage) => process.cpuUsage(previous));
  const gate = declare<string>({
    name: 'cpu-profiler',
    owner: 'performance',
    rank: 721,
    key: (key: string) => key,
    concurrency: 1,
    threshold: Duration.seconds(10),
    ceilings: {
      hold: Duration.minutes(15),
      wait: Duration.minutes(15),
      leaves: 'the inspector may be running without a tracked window; the profiler layer needs restart',
    },
    external: { named: 'CPU inspector', callsBack: false },
  });
  const session = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const opened = new Session();
      opened.connect();
      return opened;
    }).pipe(Effect.orDie),
    (opened) =>
      Effect.try(() => opened.disconnect()).pipe(
        Effect.tapError((failure) => Effect.logWarning('CPU inspector disconnect failed during release', failure)),
        Effect.ignore,
      ),
  );

  let open: {
    readonly wallTime: number;
    readonly monotonicStart: number;
    readonly cpu: NodeJS.CpuUsage;
  } | null = null;
  let keptBusyAt = Number.NEGATIVE_INFINITY;
  let capturing: CaptureWindow | null = null;

  const begin = Effect.gen(function* () {
    if (open !== null || (capturing === null && options.windowMs() <= 0)) return;
    const started = yield* post(session, 'Profiler.start').pipe(
      Effect.tapError((failure) => Effect.logWarning('The CPU sampler could not start its next window', failure.message)),
      Effect.option,
    );
    if (started._tag === 'None') return;
    open = { wallTime: yield* Clock.currentTimeMillis, monotonicStart: yield* monotonicMs, cpu: cpuUsage() };
  });

  const busyDue = (now: number): boolean => {
    const busy = options.busy;
    const window = open;
    if (busy === undefined || window === null) return false;
    const length = now - window.monotonicStart;
    if (now - keptBusyAt < busy.everyMs || length < options.windowMs() / 2) return false;
    const spent = cpuUsage(window.cpu);
    return (spent.user + spent.system) / 1_000 >= busy.cpuShare * length;
  };

  const standingRotation = Effect.gen(function* () {
    if (capturing !== null) return null;
    if (!busyDue(yield* monotonicMs)) return yield* rotate(null);
    const kept = yield* rotate('busy');
    if (kept !== null) {
      store.submit(submissionOf(kept));
      keptBusyAt = yield* monotonicMs;
    }
    return kept;
  });

  const rotate = Effect.fnUntraced(function* (keep: string | null, askedMs?: number) {
    const window = open;
    open = null;
    if (window === null) {
      yield* begin;
      return null;
    }
    const monotonicEnd = yield* monotonicMs;
    const stopped = yield* post(session, 'Profiler.stop').pipe(
      Effect.tapError((failure) => Effect.logWarning('The CPU sampler lost its current profile', failure.message)),
      Effect.option,
    );
    yield* begin;
    if (keep === null || stopped._tag === 'None') return null;
    const decoded = yield* Schema.decodeUnknownEffect(profilerStopSchema)(stopped.value).pipe(
      Effect.tapError((failure) => Effect.logWarning('The CPU inspector response has no readable profile', failure.message)),
      Effect.option,
    );
    if (decoded._tag === 'None') return null;
    const artifact = yield* Schema.decodeUnknownEffect(cpuProfileArtifactSchema)(decoded.value.profile).pipe(
      Effect.tapError((failure) => Effect.logWarning('The CPU inspector returned an invalid profile artifact', failure.message)),
      Effect.option,
    );
    if (artifact._tag === 'None') return null;
    const id = randomUUID();
    const record: StoredProfileRecord = {
      id,
      kind: 'profile',
      instanceId: options.instanceId,
      wallTime: window.wallTime,
      monotonicStart: window.monotonicStart,
      monotonicEnd,
      payload: {
        requestedBy: keep,
        requestedDurationMs: askedMs ?? Math.round(monotonicEnd - window.monotonicStart),
        profile: decoded.value.profile,
      },
    };
    return record;
  }, Effect.withTracerEnabled(false));

  const samplingIntervalUs = Math.max(1, Math.round((options.stallCeilingMs * 1000) / SAMPLES_PER_CEILING));

  yield* gate
    .hold(
      'sole',
      post(session, 'Profiler.enable').pipe(
        Effect.andThen(post(session, 'Profiler.setSamplingInterval', { interval: samplingIntervalUs })),
        Effect.andThen(begin),
        Effect.ignore,
      ),
    )
    .pipe(Effect.ignore);

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        const every = options.windowMs();
        yield* Effect.sleep(every > 0 ? every : options.stallCeilingMs * 10);
        yield* gate.hold('sole', standingRotation).pipe(Effect.ignore);
      }
    }).pipe(Effect.withTracerEnabled(false)),
  );

  return CpuProfiler.of({
    cut: (requestedBy) =>
      gate
        .hold(
          'sole',
          Effect.gen(function* () {
            const kept = yield* rotate(requestedBy);
            if (kept === null) return null;
            const window = capturing;
            if (window === null) {
              store.submit(submissionOf(kept));
              return kept;
            }
            const stored = yield* Effect.result(store.submitDurable(submissionOf(kept)));
            if (stored._tag === 'Failure') {
              window.failure = stored.failure;
              yield* Effect.logWarning('The manual CPU capture lost one of its cut profiles', stored.failure.message);
              return null;
            }
            window.cuts.push({ id: kept.id, requestedBy });
            return kept;
          }),
        )
        .pipe(
          Effect.catchTag('HoldStalled', () => Effect.succeed(null)),
          Effect.catchTag('HoldCut', () => Effect.succeed(null)),
          Effect.withTracerEnabled(false),
        ),
    window: (request) =>
      Effect.suspend(() => {
        const window: CaptureWindow = { cuts: [], failure: null };
        return Effect.gen(function* () {
          const opened = yield* gate
            .hold(
              'sole',
              Effect.tap(rotate(null), () =>
                Effect.sync(() => {
                  capturing = window;
                }).pipe(Effect.andThen(begin)),
              ),
            )
            .pipe(
              Effect.asVoid,
              Effect.catchTag('HoldStalled', () => Effect.succeed('stalled' as const)),
              Effect.catchTag('HoldCut', () => Effect.succeed('stalled' as const)),
            );
          if (opened === 'stalled') return null;
          yield* Effect.sleep(request.requestedDurationMs);
          const record = yield* gate
            .hold(
              'sole',
              Effect.gen(function* () {
                capturing = null;
                const record = yield* rotate(request.requestedBy, request.requestedDurationMs);
                if (window.failure !== null) return yield* window.failure;
                if (record === null) return null;
                yield* store.submitDurable(submissionOf(record));
                return record;
              }),
            )
            .pipe(
              Effect.catchTag('HoldStalled', () => Effect.succeed(null)),
              Effect.catchTag('HoldCut', () => Effect.succeed(null)),
            );
          return record === null ? null : { record, cuts: window.cuts };
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (capturing === window) capturing = null;
            }),
          ),
          Effect.withTracerEnabled(false),
        );
      }),
    running: () => open !== null,
  });
});

function post(
  session: Session,
  method: 'Profiler.enable' | 'Profiler.start' | 'Profiler.stop' | 'Profiler.setSamplingInterval',
  params?: Record<string, unknown>,
): Effect.Effect<unknown, Error> {
  return Effect.callback<unknown, Error>((resume) => {
    session.post(method, params ?? {}, (error, result) => {
      resume(error ? Effect.fail(error) : Effect.succeed(result));
    });
  });
}
