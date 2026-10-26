import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as Effect from 'effect/Effect';
import * as Tracer from 'effect/Tracer';
import * as PerformanceTracer from './PerformanceTracer.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { KEEP_ONE_TRACE_IN } from './TraceSampler.js';

const ITERATIONS = 20_000;
const WARMUP = 2_000;
const EVERY_TRACE = () => 1;
const SHIPPED_SHARE = () => KEEP_ONE_TRACE_IN;

const tracedStep = Effect.fn('PerformanceTracer.bench.delta')(function* (value: number) {
  return value + 1;
});

const untracedStep = Effect.fnUntraced(function* (value: number) {
  return value + 1;
});

const runSteps = Effect.fnUntraced(function* (count: number, step: (value: number) => Effect.Effect<number>) {
  let value = 0;
  for (let index = 0; index < count; index += 1) value = yield* step(value);
  return value;
});

const measure = Effect.fnUntraced(function* (name: string, step: (value: number) => Effect.Effect<number>, tracer?: Tracer.Tracer) {
  const bound = (count: number) => {
    const work = runSteps(count, step);
    return tracer === undefined ? work : work.pipe(Effect.withTracer(tracer));
  };
  yield* bound(WARMUP);
  const started = performance.now();
  const value = yield* bound(ITERATIONS);
  const elapsedMs = performance.now() - started;
  console.log(`${name}\t${((elapsedMs * 1_000) / ITERATIONS).toFixed(3)} us/call\t${value} steps`);
});

const program = PerformanceStore.use((store) =>
  Effect.gen(function* () {
    const everyTrace = yield* PerformanceTracer.make({
      instanceId: 'performance-tracer-bench',
      recordFloorMicros: 0,
      keepOneTraceIn: EVERY_TRACE,
    });
    const sampled = yield* PerformanceTracer.make({
      instanceId: 'performance-tracer-bench',
      recordFloorMicros: 1_000,
      keepOneTraceIn: SHIPPED_SHARE,
    });

    console.log(`PerformanceTracer submit-side benchmark (${ITERATIONS.toLocaleString()} calls)`);
    yield* measure('Effect.fn, default tracer', tracedStep);
    yield* measure('Effect.fnUntraced, default tracer', untracedStep);
    yield* measure('Effect.fn, PerformanceTracer, every trace stored', tracedStep, everyTrace);
    yield* measure(`Effect.fn, PerformanceTracer, one trace in ${KEEP_ONE_TRACE_IN}`, tracedStep, sampled);
    yield* measure('Effect.fnUntraced, PerformanceTracer', untracedStep, sampled);
    yield* store.flush;
  }),
).pipe(
  Effect.provide(
    performanceStoreLayer({
      path: ':memory:',
      instanceId: 'performance-tracer-bench',
      maxPendingBytes: () => 64 * 1024 * 1024,
      maxStoredBytes: () => 256 * 1024 * 1024,
    }),
  ),
);

BunRuntime.runMain(program);
