import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Metric from 'effect/Metric';
import * as Option from 'effect/Option';
import type * as Tracer from 'effect/Tracer';
import * as PerformanceTracer from './PerformanceTracer.js';
import { PerformanceStore } from './store/store.js';
import type { PerformanceSubmission } from './store/records.js';
import { CurrentTraceSampler, TraceSampler } from './TraceSampler.js';

const SIMULATED_MS = 20 * 60_000;
const RUNS = 6;
const REQUEST_EVERY_MS = 100;
const STALL_EVERY_MS = 30_000;
const STALL_MS = 150;
const STALL_NAMED_AFTER_MS = 25;
const ITERATIONS = 5;
const SEED = 20260925;
const HISTOGRAM_BOUNDS_MS = [
  0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288,
];
const TOOL_CALL_COUNTS = [2, 19, 12, 4, 8, 15, 26, 19, 157, 232, 195, 190, 142, 87, 46, 26, 14, 8, 1];
const MODEL_STEP_COUNTS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 55, 375, 241, 185, 64, 31, 9, 2, 2];
const TOOL_CALLS_PER_STEP = 1203 / 964;

const PLAIN = Context.empty();
const SUCCEEDED = Exit.succeed(undefined);
const FAILED = Exit.fail('failed');

type Spec = {
  readonly name: string;
  readonly startMs: number;
  endMs: number;
  readonly parent: Spec | null;
  readonly unit: boolean;
  failed: boolean;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly depth: number;
  incident: boolean;
  span?: Tracer.Span;
};

type Event =
  | { readonly at: number; readonly rank: number; readonly depth: number; readonly kind: 'open' | 'end'; readonly spec: Spec }
  | {
      readonly at: number;
      readonly rank: number;
      readonly depth: number;
      readonly kind: 'stall';
      readonly fromMs: number;
      readonly toMs: number;
    };

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function workload(stallEveryMs: number | null): { readonly specs: Spec[]; readonly events: Event[] } {
  const next = random(SEED);
  const specs: Spec[] = [];
  const span = (
    name: string,
    startMs: number,
    endMs: number,
    parent: Spec | null,
    options: { readonly unit?: boolean; readonly attributes?: Record<string, unknown> } = {},
  ): Spec => {
    const spec: Spec = {
      name,
      startMs,
      endMs,
      parent,
      unit: options.unit ?? false,
      failed: false,
      attributes: options.attributes ?? {},
      depth: parent === null ? 0 : parent.depth + 1,
      incident: parent?.incident ?? false,
    };
    specs.push(spec);
    return spec;
  };
  const queries = (parent: Spec, fromMs: number, toMs: number, count: number): void => {
    const gap = (toMs - fromMs) / (count + 1);
    for (let index = 1; index <= count; index += 1) {
      const at = fromMs + gap * index;
      const read = span(index % 3 === 0 ? 'Store.transaction' : 'CommandReader.read', at, at + Math.min(gap / 2, 0.2 + next() * 4), parent);
      span('sql.execute', read.startMs + 0.05, read.startMs + 0.05 + (read.endMs - read.startMs) / 2, read, {
        attributes: { 'db.system.name': 'sqlite', 'db.operation.name': 'executeValues' },
      });
    }
  };
  const measured = (counts: readonly number[]): number => {
    const total = counts.reduce((sum, count) => sum + count, 0);
    let roll = next() * total;
    let bucket = 0;
    while (bucket < counts.length - 1 && roll >= (counts[bucket] ?? 0)) {
      roll -= counts[bucket] ?? 0;
      bucket += 1;
    }
    const upper = HISTOGRAM_BOUNDS_MS[bucket] ?? 1;
    const lower = bucket === 0 ? upper / 2 : (HISTOGRAM_BOUNDS_MS[bucket - 1] ?? upper / 2);
    return lower * (upper / lower) ** next();
  };
  const toolMs = (): number => Math.max(1, measured(TOOL_CALL_COUNTS));
  const tool = (parent: Spec, runId: string, atMs: number, durationMs: number, toolName: string, incident: boolean): Spec => {
    const call = span('agent.tool-call', atMs, atMs + durationMs, parent, {
      unit: true,
      attributes: { runId, toolName, toolCallId: `call-${specs.length}`, executedBy: 'host' },
    });
    call.incident = incident;
    span('Worlds.lease', atMs + 0.1, atMs + 0.2, call);
    const operation = span(toolName, atMs + 0.3, atMs + durationMs - 0.3, call);
    if (incident) {
      const wait = span('Terminals.commandWait', operation.startMs + 0.1, operation.startMs + durationMs - 2_960, operation);
      queries(wait, wait.startMs, wait.startMs + 20, 4);
      const waited = span('Terminals.wait', wait.startMs + 21, wait.endMs - 0.1, wait);
      queries(waited, waited.startMs, waited.endMs, 3);
      const read = span('CommandOutput.read', wait.endMs + 0.2, operation.endMs - 0.2, operation);
      queries(read, read.startMs, read.endMs, 12);
      return call;
    }
    queries(operation, operation.startMs, operation.endMs, 10 + Math.floor(next() * 50));
    if (next() < 0.005) {
      operation.failed = true;
      call.failed = true;
    }
    return call;
  };

  for (let run = 0; run < RUNS; run += 1) {
    const runId = `run-${run}`;
    const root = span('agent.run', next() * 2_000, SIMULATED_MS, null, { unit: true, attributes: { runId } });
    let at = root.startMs + 1;
    let stepNumber = 0;
    let incidentDue = run === 0;
    while (at < SIMULATED_MS - 180_000) {
      const stepMs = measured(MODEL_STEP_COUNTS);
      const step = span('agent.model-step', at, at + stepMs, root, { unit: true, attributes: { runId, stepNumber } });
      const plan = span('planStep', at + 1, at + 6, step);
      queries(plan, plan.startMs, plan.endMs, 2);
      const call = span('callModel', at + 8, at + stepMs - 2, step);
      queries(call, call.endMs - 5, call.endMs, 4);
      at = step.endMs + 1;
      const tools = span('runStepTools', at, at, root);
      span('pathPreparation', at + 0.2, at + 0.7, tools);
      let toolAt = at + 1;
      const calls = Math.floor(TOOL_CALLS_PER_STEP) + (next() < TOOL_CALLS_PER_STEP % 1 ? 1 : 0);
      for (let index = 0; index < calls; index += 1) {
        const incident = incidentDue && at > SIMULATED_MS / 2;
        const called = incident
          ? tool(tools, runId, toolAt, 86_451, 'read_output', true)
          : tool(tools, runId, toolAt, toolMs(), index % 2 === 0 ? 'bash' : 'read', false);
        if (incident) incidentDue = false;
        toolAt = called.endMs + 1;
      }
      const persisted = span('Store.transaction', toolAt, toolAt + 30, tools);
      queries(persisted, persisted.startMs, persisted.endMs, 12);
      tools.endMs = persisted.endMs + 1;
      at = tools.endMs + 5;
      stepNumber += 1;
    }
  }

  for (let at = 0; at < SIMULATED_MS; at += REQUEST_EVERY_MS) {
    const durationMs = next() < 0.01 ? 300 + next() * 500 : 2 + next() * 30;
    const request = span('http.request', at, at + durationMs, null, { attributes: { route: '/api/op' } });
    queries(request, request.startMs, request.endMs, 3 + Math.floor(next() * 3));
  }

  const events: Event[] = [];
  for (const spec of specs) {
    events.push({ at: spec.startMs, rank: 0, depth: spec.depth, kind: 'open', spec });
    events.push({ at: spec.endMs, rank: 1, depth: -spec.depth, kind: 'end', spec });
  }
  for (let fromMs = stallEveryMs ?? SIMULATED_MS; fromMs < SIMULATED_MS; fromMs += stallEveryMs ?? SIMULATED_MS) {
    const toMs = fromMs + STALL_MS;
    events.push({ at: toMs + STALL_NAMED_AFTER_MS, rank: 2, depth: 0, kind: 'stall', fromMs, toMs });
  }
  events.sort((left, right) => left.at - right.at || left.rank - right.rank || left.depth - right.depth);
  return { specs, events };
}

type Reading = {
  readonly spans: number;
  readonly records: number;
  readonly bytes: number;
  readonly cpuMs: number;
  readonly wallMs: number;
  readonly byName: ReadonlyMap<string, number>;
  readonly incident: { readonly stored: number; readonly of: number };
};

const drive = Effect.fnUntraced(
  function* (specs: Spec[], events: Event[]) {
    let clockMs = 0;
    const sampler = new TraceSampler(() => clockMs);
    const stored = new Set<string>();
    const byName = new Map<string, number>();
    let records = 0;
    let bytes = 0;
    const submit = (submission: PerformanceSubmission): void => {
      records += 1;
      bytes += submission.byteSize;
      stored.add(submission.record.id);
      if (submission.record.kind === 'span') {
        const name = (submission.record as { readonly name: string }).name;
        byName.set(name, (byName.get(name) ?? 0) + 1);
      }
    };
    const store = PerformanceStore.of({
      openGroup: () => {},
      closeGroup: () => {},
      submit,
      submitDurable: (submission) => Effect.sync(() => submit(submission)),
      readWorkerMemory: () => Effect.die('the benchmark store holds no worker'),
      flush: Effect.void,
      pressure: () => ({
        state: 'ready',
        pendingRecords: 0,
        pendingBytes: 0,
        peakPendingBytes: 0,
        persistedRecords: records,
        droppedRecords: 0,
      }),
      diagnostics: () => ({
        state: 'ready',
        path: ':benchmark:',
        restarts: 0,
        activeGroups: 0,
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
    const units = new Set(events.flatMap((event) => (event.kind === 'open' && event.spec.unit ? [event.spec.name] : [])));
    const tracer = yield* PerformanceTracer.make({ instanceId: 'bench', recordFloorMicros: 1_000, units }).pipe(
      Effect.provideService(PerformanceStore, store),
      Effect.provideService(CurrentTraceSampler, sampler),
    );

    let spans = 0;
    const cpu = process.cpuUsage();
    const started = performance.now();
    for (const event of events) {
      clockMs = event.at;
      if (event.kind === 'stall') {
        sampler.coverStall(event.fromMs, event.toMs);
        continue;
      }
      const spec = event.spec;
      if (event.kind === 'open') {
        const parent = spec.parent?.span;
        const opened = tracer.span({
          name: spec.name,
          parent: parent === undefined ? Option.none() : Option.some(parent),
          annotations: PLAIN,
          links: [],
          startTime: BigInt(Math.round(spec.startMs * 1_000_000)),
          kind: 'internal',
          root: parent === undefined,
          sampled: true,
        });
        for (const [key, value] of Object.entries(spec.attributes)) opened.attribute(key, value);
        spec.span = opened;
        continue;
      }
      spec.span?.end(BigInt(Math.round(spec.endMs * 1_000_000)), spec.failed ? FAILED : SUCCEEDED);
      spans += 1;
    }
    const wallMs = performance.now() - started;
    const used = process.cpuUsage(cpu);

    const incident = specs.filter((spec) => spec.incident);
    const reading: Reading = {
      spans,
      records,
      bytes,
      cpuMs: (used.user + used.system) / 1_000,
      wallMs,
      byName,
      incident: { stored: incident.filter((spec) => stored.has(spec.span?.spanId ?? '')).length, of: incident.length },
    };
    for (const spec of specs) delete spec.span;
    return reading;
  },
  (effect) => Effect.provideService(effect, Metric.MetricRegistry, new Map()),
);

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const scenario = Effect.fnUntraced(function* (stallEveryMs: number | null) {
  const { specs, events } = workload(stallEveryMs);
  const readings: Reading[] = [];
  yield* drive(specs, events);
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) readings.push(yield* drive(specs, events));
  const last = readings.at(-1);
  if (last === undefined) return;
  const simulatedSeconds = SIMULATED_MS / 1_000;
  const cpu = readings.map((reading) => reading.cpuMs);
  const cpuMs = median(cpu);
  const records = readings.map((reading) => reading.records);
  const bytes = median(readings.map((reading) => reading.bytes));
  const stalls = stallEveryMs === null ? 'no stall' : `a ${STALL_MS} ms stall every ${stallEveryMs / 1_000} s`;
  console.log(`\n${RUNS} runs and one request every ${REQUEST_EVERY_MS} ms, ${simulatedSeconds} s simulated, ${stalls}`);
  console.log(`spans ended\t${last.spans}`);
  console.log(
    `records submitted (median of ${ITERATIONS})\t${median(records)}\t${(median(records) / simulatedSeconds).toFixed(1)}/s simulated\trange ${Math.min(...records)}–${Math.max(...records)}`,
  );
  console.log(
    `bytes submitted (median)\t${(bytes / 1024 / 1024).toFixed(2)} MiB\t${(bytes / simulatedSeconds / 1024).toFixed(1)} KiB/s simulated`,
  );
  const perSpan = (ms: number): string => ((ms * 1_000) / last.spans).toFixed(2);
  const wall = readings.map((reading) => reading.wallMs);
  console.log(
    `tracer cpu (median of ${ITERATIONS})\t${cpuMs.toFixed(1)} ms\t${perSpan(cpuMs)} us per ended span\trange ${perSpan(Math.min(...cpu))}–${perSpan(Math.max(...cpu))} us`,
  );
  console.log(
    `loop wall (median of ${ITERATIONS})\t${median(wall).toFixed(1)} ms\t${perSpan(median(wall))} us per ended span\trange ${perSpan(Math.min(...wall))}–${perSpan(Math.max(...wall))} us`,
  );
  console.log(`incident tool call subtree stored\t${last.incident.stored} of ${last.incident.of}`);
  for (const name of ['agent.run', 'agent.model-step', 'agent.tool-call', 'runStepTools', 'http.request', 'sql.execute']) {
    console.log(`  ${name}\t${last.byName.get(name) ?? 0}`);
  }
});

const program = Effect.gen(function* () {
  yield* scenario(STALL_EVERY_MS);
  yield* scenario(null);
});

Effect.runSync(program);
