import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import type * as Tracer from 'effect/Tracer';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import * as LoopStalls from './LoopStalls.js';
import type { TimeCursor } from './protocol/queries.js';
import type { StallReading } from './protocol/reports.js';
import type { PerformanceStoreOptions } from './store/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import * as PerformanceTracer from './PerformanceTracer.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { CpuProfiler, cpuProfilerNoneLayer } from './CpuProfiler.js';

const CEILING_MS = 100;
const PULSE_MS = CEILING_MS / 4;
const BLOCK_MS = 250;
const NOTHING_BY_HASH = () => Number.MAX_SAFE_INTEGER;

const readStalls = Effect.gen(function* () {
  const reports = yield* PerformanceReports;
  const readings: StallReading[] = [];
  let after: TimeCursor | undefined;
  do {
    const page = yield* reports.read({ type: 'stalls', limit: 20, after });
    if (page.type !== 'stalls') return yield* Effect.die('unexpected report');
    readings.push(...page.stalls);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return readings;
});

it.live('a synchronous block is recorded with its own interval and measured CPU window', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-loop-stalls-');
    const path = join(directory, 'performance.sqlite');
    const result = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        yield* Effect.sleep(PULSE_MS * 2);
        const started = performance.now();
        blockLoop(BLOCK_MS);
        const ended = performance.now();
        yield* Effect.sleep(PULSE_MS * 2);
        yield* store.flush;
        return { readings: yield* readStalls, started, ended };
      }),
    ).pipe(Effect.provide(LoopStalls.layer({ instanceId: 'process', ceilingMs: CEILING_MS })), Effect.provide(performanceLayer(path)));

    const stall = result.readings.find(
      ({ stall }) => stall.monotonicStart <= result.started + PULSE_MS && stall.monotonicEnd >= result.ended,
    )?.stall;
    if (stall === undefined) return yield* Effect.die('the deliberately blocked interval was not recorded');
    expect(stall.monotonicEnd - stall.monotonicStart).toBe(stall.payload.delayMs);
    expect(stall.payload.delayMs).toBeGreaterThan(CEILING_MS);
    expect(stall.payload.delayMs + PULSE_MS).toBeGreaterThanOrEqual(result.ended - result.started);
    expect(stall.payload.cpu.userMicros).toBeGreaterThanOrEqual(0);
    expect(stall.payload.cpu.systemMicros).toBeGreaterThanOrEqual(0);
    expect(stall.payload.memory.rssBytes).toBeGreaterThan(0);
    expect(stall.payload.memory.heapUsedBytes).toBeGreaterThan(0);
    const window = stall.payload.cpuWindowMs;
    const loopCpu = stall.payload.loopCpu;
    if (window === undefined || loopCpu === undefined) return yield* Effect.die('the stall stated no loop CPU window');
    expect(window).toBeGreaterThanOrEqual(stall.payload.delayMs);
    expect(loopCpu.userMicros + loopCpu.systemMicros).toBeGreaterThanOrEqual(0);
  }),
);

it.live('stall loop CPU stays within its own thread counter while a worker runs', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-loop-stalls-worker-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.acquireRelease(Effect.sync(startCpuWorker), (worker) => Effect.sync(worker.stop));
    const before = process.threadCpuUsage();
    const result = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        yield* Effect.sleep(PULSE_MS * 2);
        const started = performance.now();
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BLOCK_MS);
        const ended = performance.now();
        yield* Effect.sleep(PULSE_MS * 2);
        yield* store.flush;
        return { readings: yield* readStalls, started, ended };
      }),
    ).pipe(Effect.provide(LoopStalls.layer({ instanceId: 'process', ceilingMs: CEILING_MS })), Effect.provide(performanceLayer(path)));
    const after = process.threadCpuUsage();
    const stall = result.readings.find(
      ({ stall }) => stall.monotonicStart <= result.started + PULSE_MS && stall.monotonicEnd >= result.ended,
    )?.stall;
    if (stall === undefined) return yield* Effect.die('the blocking syscall interval was not recorded');
    const loopCpu = stall.payload.loopCpu;
    if (loopCpu === undefined) return yield* Effect.die('the stall carried no loop CPU evidence');
    const recorded = loopCpu.userMicros + loopCpu.systemMicros;
    expect(recorded).toBeLessThanOrEqual(after.user + after.system - before.user - before.system);
    expect(recorded).toBeGreaterThanOrEqual(0);
    expect(stall.payload.delayMs + PULSE_MS).toBeGreaterThanOrEqual(result.ended - result.started);
  }),
);

it.live('closing the layer scope preserves the recorded prefix through a further block', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-loop-stalls-scope-');
    const path = join(directory, 'performance.sqlite');
    const result = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          yield* Effect.sleep(PULSE_MS * 2);
          blockLoop(BLOCK_MS);
          yield* Effect.sleep(PULSE_MS * 2);
        }).pipe(Effect.provide(LoopStalls.layer({ instanceId: 'process', ceilingMs: CEILING_MS })));
        yield* store.flush;
        const closed = yield* readStalls;
        blockLoop(BLOCK_MS);
        yield* Effect.sleep(PULSE_MS * 2);
        yield* store.flush;
        return { closed, later: yield* readStalls };
      }),
    ).pipe(Effect.provide(performanceLayer(path)));
    expect(result.closed.length).toBeGreaterThan(0);
    expect(result.later).toEqual(result.closed);
  }),
);

it.live('the stall names the trace the loop froze inside, and that trace is kept', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-loop-stalls-cover-');
    const path = join(directory, 'performance.sqlite');
    const result = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        const reports = yield* PerformanceReports;
        const tracer = yield* PerformanceTracer.make({
          instanceId: 'process',
          recordFloorMicros: 0,
          keepOneTraceIn: NOTHING_BY_HASH,
        });
        yield* Effect.sleep(PULSE_MS * 2);

        const frozen = open(tracer, 'frozen.work');
        blockLoop(BLOCK_MS);
        frozen.end(1_000_000n, Exit.succeed(undefined));
        if (!(yield* awaitStall(store))) return yield* Effect.die('the blocked loop recorded no stall');
        const covered = yield* reports.read({ type: 'slow', name: 'frozen.work', limit: 10 });

        open(tracer, 'quiet.work').end(1_000_000n, Exit.succeed(undefined));
        yield* store.flush;
        const quiet = yield* reports.read({ type: 'slow', name: 'quiet.work', limit: 10 });
        if (covered.type !== 'slow' || quiet.type !== 'slow') return yield* Effect.die('unexpected report');
        return { covered, quiet };
      }),
    ).pipe(Effect.provide(LoopStalls.layer({ instanceId: 'process', ceilingMs: CEILING_MS })), Effect.provide(performanceLayer(path)));

    expect(result.covered.spans.map((span) => span.name)).toEqual(['frozen.work']);
    expect(result.quiet.spans).toEqual([]);
  }),
);

const awaitStall = Effect.fnUntraced(function* (store: Context.Service.Shape<typeof PerformanceStore>) {
  for (let pulse = 0; pulse < 40; pulse += 1) {
    yield* Effect.sleep(PULSE_MS);
    yield* store.flush;
    if ((yield* readStalls).length > 0) return true;
  }
  return false;
});

function open(tracer: Tracer.Tracer, name: string): Tracer.Span {
  return tracer.span({
    name,
    parent: Option.none(),
    annotations: Context.empty(),
    links: [],
    startTime: 0n,
    kind: 'internal',
    root: true,
    sampled: true,
  });
}

function blockLoop(milliseconds: number): void {
  const started = performance.now();
  while (performance.now() - started < milliseconds) {}
}

function startCpuWorker(): { readonly stop: () => void } {
  const source = `
    self.onmessage = (event) => {
      const state = new Int32Array(event.data);
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
      let value = 1;
      while (Atomics.load(state, 1) === 0) {
        for (let index = 0; index < 10000; index += 1) value = Math.imul(value + index, 1664525);
      }
      postMessage(value);
    };
  `;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
  worker.postMessage(state.buffer);
  Atomics.wait(state, 0, 0, 1_000);
  if (Atomics.load(state, 0) !== 1) {
    worker.terminate();
    URL.revokeObjectURL(url);
    throw new Error('the CPU worker did not start');
  }
  return {
    stop: () => {
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

function storeOptions(path: string): PerformanceStoreOptions {
  return { path, instanceId: 'process', maxPendingBytes: () => 1_000_000, maxStoredBytes: () => 1_000_000 };
}

function performanceLayer(path: string) {
  return performanceReportsLayer.pipe(
    Layer.provideMerge(cpuProfilerNoneLayer),
    Layer.provideMerge(performanceStoreLayer(storeOptions(path))),
  );
}
