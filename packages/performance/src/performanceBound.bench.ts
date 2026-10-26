import * as Clock from 'effect/Clock';
import * as Data from 'effect/Data';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Ref from 'effect/Ref';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type {
  MetricSamplePayload,
  PerformanceRecordKind,
  SpanPayload,
  StallPayload,
  StorePressure,
  VitalPayload,
} from './protocol/records.js';
import { recordByteSize, type JsonValue, type PerformanceRecord, type PerformanceSubmission } from './store/records.js';
import { PerformanceStore, PerformanceStoreReader, performanceStoreLayer } from './store/store.js';
import { readProcessMemory } from './ProcessVitals.js';
import { ringRoot } from './SegmentRing.js';

class BoundBenchFailure extends Data.TaggedError('BoundBenchFailure')<{ readonly message: string }> {}

const USAGE = 'usage: bun packages/performance/src/performanceBound.bench.ts <holdMinutes> [--bound-mib=256] [--rate=160] [--keep]';

const fail = (message: string) => Effect.fail(new BoundBenchFailure({ message }));
const attempt = <A>(read: () => A) => Effect.try({ try: read, catch: (error) => new BoundBenchFailure({ message: String(error) }) });
const attemptAsync = <A>(read: () => Promise<A>) =>
  Effect.tryPromise({ try: read, catch: (error) => new BoundBenchFailure({ message: String(error) }) });

const spawned = async (argv: ReadonlyArray<string>) => {
  const child = Bun.spawn([...argv], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout };
};

const TICK_MS = 100;
const PENDING_BOUND_BYTES = 64 * 1024 * 1024;
const LOOP_DELAY_RESOLUTION_MS = 10;
const FILL_REPORT_MS = 30_000;
const MIX_CYCLE = 1_600;
const RARE_KINDS: ReadonlyArray<readonly [PerformanceRecordKind, number]> = [
  ['stall', 1],
  ['metric', 15],
  ['vital', 80],
];

const SPAN_NAMES = [
  'graph.read_owners',
  'thread.open',
  'llm.request',
  'tool.call',
  'graph.search_blocks',
  'store.write_records',
  'http.request',
  'transcript.append',
  'graph.query_blocks',
  'host.execution',
] as const;
const SPAN_DURATIONS_MS = [0.42, 3.1, 12.5, 47.2, 140.6] as const;
const METRIC_BOUNDARIES_MS = Array.from({ length: 34 }, (_, bucket) => 0.5 * 2 ** bucket);
const TRACE_SPANS = 3;

type RunOptions = {
  readonly holdMinutes: number;
  readonly boundBytes: number;
  readonly rate: number;
  readonly keep: boolean;
};

function parameters(argv: ReadonlyArray<string>): RunOptions {
  const positional = argv.find((argument) => !argument.startsWith('--'));
  const flag = (name: string, fallback: number) => {
    const argument = argv.find((value) => value.startsWith(`--${name}=`));
    return argument === undefined ? fallback : Number(argument.slice(name.length + 3));
  };
  const holdMinutes = positional === undefined ? 5 : Number(positional);
  const boundMib = flag('bound-mib', 256);
  const rate = flag('rate', 160);
  if (!Number.isFinite(holdMinutes) || holdMinutes <= 0) throw new Error(`hold minutes must be a positive number\n${USAGE}`);
  if (!Number.isFinite(boundMib) || boundMib <= 0) throw new Error(`bound MiB must be a positive number\n${USAGE}`);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`rate must be a positive number of records per second\n${USAGE}`);
  return { holdMinutes, boundBytes: Math.round(boundMib * 1024 * 1024), rate: Math.round(rate), keep: argv.includes('--keep') };
}

function mixPlan(): ReadonlyArray<PerformanceRecordKind> {
  const plan: Array<PerformanceRecordKind | undefined> = new Array(MIX_CYCLE).fill(undefined);
  for (const [kind, count] of RARE_KINDS) {
    for (let index = 0; index < count; index += 1) {
      let slot = Math.floor(((index + 0.5) * MIX_CYCLE) / count);
      while (plan[slot] !== undefined) slot = (slot + 1) % MIX_CYCLE;
      plan[slot] = kind;
    }
  }
  return plan.map((kind) => kind ?? 'span');
}

const hex = (value: number, width: number) => value.toString(16).padStart(width, '0').slice(-width);

function spanAttributes(): SpanPayload['attributes'] {
  const attributes: Record<string, JsonValue> = {
    'thread.id': randomUUID(),
    'run.id': randomUUID(),
    'agent.id': randomUUID(),
    'thread.fold': 'root/task/step',
    'tool.name': 'graph_search_blocks',
    'tool.call.id': randomUUID(),
    'operation.kind': 'read_owners',
    'db.system.name': 'sqlite',
    'db.operation.name': 'select',
    'db.collection.name': 'blocks',
    project: 'runlith',
    narrowed: 12,
    blocks: 34,
    anchors: 7,
    files: 3,
    candidates: 19,
    created: 2,
    resolved: 5,
    rows: 64,
    bytes: 65_536,
    records: 2_048,
    events: 512,
    compressed: true,
    outcome: 'ok',
    reason: 'slow-tool',
    'http.route': '/api/performance/vitals',
    'http.response.status_code': 200,
    'encode.ms': 1.23,
    'write.ms': 4.56,
  };
  return attributes;
}

function recordSource(instanceId: string, pressure: () => StorePressure) {
  let spans = 0;
  let previousCpu = process.cpuUsage();
  let loopDelay = { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 };
  return {
    setLoopDelay: (reading: typeof loopDelay) => {
      loopDelay = reading;
    },
    submission: (kind: PerformanceRecordKind, ordinal: number): PerformanceSubmission => {
      const wallTime = Date.now();
      const monotonicStart = performance.now();
      if (kind === 'span') {
        const traceId = hex(Math.floor(spans / TRACE_SPANS), 32);
        const record: PerformanceRecord<'span', SpanPayload> = {
          id: hex(spans, 16),
          kind: 'span',
          instanceId,
          wallTime,
          monotonicStart,
          monotonicEnd: monotonicStart + SPAN_DURATIONS_MS[spans % SPAN_DURATIONS_MS.length]!,
          traceId,
          parentId: spans % TRACE_SPANS === 0 ? null : hex(spans - 1, 16),
          name: SPAN_NAMES[spans % SPAN_NAMES.length]!,
          payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: spanAttributes() },
        };
        spans += 1;
        return { record, retentionKey: traceId, byteSize: recordByteSize(record) };
      }
      const currentCpu = process.cpuUsage();
      const cpu = { userMicros: currentCpu.user - previousCpu.user, systemMicros: currentCpu.system - previousCpu.system };
      if (kind === 'vital') {
        const record: PerformanceRecord<'vital', VitalPayload> = {
          id: randomUUID(),
          kind: 'vital',
          instanceId,
          wallTime,
          monotonicStart,
          monotonicEnd: monotonicStart + 5_000,
          payload: { cpu, memory: readProcessMemory(), loopDelay, store: pressure() },
        };
        previousCpu = currentCpu;
        return { record, retentionKey: record.id, byteSize: recordByteSize(record) };
      }
      if (kind === 'metric') {
        const record: PerformanceRecord<'metric', MetricSamplePayload> = {
          id: randomUUID(),
          kind: 'metric',
          instanceId,
          wallTime,
          monotonicStart,
          monotonicEnd: monotonicStart,
          name: SPAN_NAMES[ordinal % SPAN_NAMES.length]!,
          payload: {
            boundariesMs: [...METRIC_BOUNDARIES_MS],
            bucketCounts: METRIC_BOUNDARIES_MS.map((_, bucket) => (bucket * 7 + ordinal) % 23),
            count: 4_812,
            failures: 3,
            sumMs: 21_345.6,
            minMs: 0.4,
            maxMs: 512.2,
          },
        };
        previousCpu = currentCpu;
        return { record, retentionKey: record.id, byteSize: recordByteSize(record) };
      }
      const record: PerformanceRecord<'stall', StallPayload> = {
        id: randomUUID(),
        kind: 'stall',
        instanceId,
        wallTime,
        monotonicStart,
        monotonicEnd: monotonicStart + 112.3,
        payload: {
          delayMs: 112.3,
          cpu,
          loopCpu: { userMicros: 98_765, systemMicros: 2_100 },
          cpuWindowMs: 5_010,
          memory: readProcessMemory(),
        },
      };
      previousCpu = currentCpu;
      return { record, retentionKey: record.id, byteSize: recordByteSize(record) };
    },
  };
}

type ThreadReading = {
  readonly mainSeconds: number;
  readonly threadSeconds: ReadonlyArray<number>;
  readonly unparsed: number;
};

const psSeconds = (text: string): number => {
  const [days, rest] = text.includes('-') ? text.split('-', 2) : [undefined, text];
  const parts = (rest ?? '').split(':').map(Number);
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds + (days === undefined ? 0 : Number(days) * 86_400);
};

async function readThreads(pid: number): Promise<ThreadReading> {
  const child = await spawned(['ps', '-M', String(pid)]);
  if (child.exitCode !== 0) throw new Error(`ps -M ${pid} exited ${child.exitCode}`);
  let mainSeconds: number | null = null;
  const threadSeconds: number[] = [];
  let unparsed = 0;
  for (const line of child.stdout.split('\n')) {
    const tokens = line
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.length === 0 || tokens[0] === 'USER') continue;
    const threadRow = /^\d+$/.test(tokens[0]!);
    const seconds = threadRow
      ? psSeconds(tokens[4] ?? '') + psSeconds(tokens[5] ?? '')
      : psSeconds(tokens[6] ?? '') + psSeconds(tokens[7] ?? '');
    const shaped = threadRow ? tokens.length === 6 : tokens.length >= 8;
    if (!shaped || !Number.isFinite(seconds)) {
      unparsed += 1;
      continue;
    }
    if (threadRow) threadSeconds.push(seconds);
    else if (mainSeconds === null) mainSeconds = seconds;
    else unparsed += 1;
  }
  if (mainSeconds === null && threadSeconds.length === 0) throw new Error(`ps -M ${pid} listed no thread`);
  return { mainSeconds: mainSeconds ?? 0, threadSeconds, unparsed };
}

function threadDeltas(before: ReadonlyArray<number>, after: ReadonlyArray<number>) {
  const pool = [...before];
  const deltas: number[] = [];
  let freshRows = 0;
  for (const value of after) {
    let chosen = -1;
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index]!;
      if (candidate <= value && (chosen === -1 || candidate > pool[chosen]!)) chosen = index;
    }
    if (chosen === -1) {
      freshRows += 1;
      deltas.push(Math.max(0, value));
      continue;
    }
    deltas.push(Math.max(0, value - pool[chosen]!));
    pool[chosen] = Number.POSITIVE_INFINITY;
  }
  return { deltas, freshRows };
}

type LoopReading = { readonly count: number; readonly p50Ms: number; readonly p99Ms: number; readonly maxMs: number };
type DroppedKinds = Readonly<Record<string, number>>;

type Snapshot = {
  readonly atMs: number;
  readonly threads: ThreadReading;
  readonly cpuUsage: NodeJS.CpuUsage;
  readonly loopDelay: LoopReading | null;
  readonly fileBytes: number;
  readonly mainFileBytes: number;
  readonly walBytes: number;
  readonly state: string;
  readonly restarts: number;
  readonly lastError: string | null;
  readonly pendingRecords: number;
  readonly pendingBytes: number;
  readonly peakPendingBytes: number;
  readonly dropCount: number;
  readonly evictedSegments: number;
  readonly lastEvictionMs: number | null;
  readonly uncertainRecords: number;
  readonly persistedRecords: number;
  readonly sessionDrops: number;
  readonly sessionDroppedKinds: DroppedKinds;
};

const fileBytes = (path: string) => {
  const root = ringRoot(path);
  const segments = join(root, 'segments');
  let main = 0;
  let wal = 0;
  for (const directory of [root, segments]) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const bytes = statSync(join(directory, entry.name)).size;
      if (entry.name.endsWith('-wal') || entry.name.endsWith('-shm')) wal += bytes;
      else main += bytes;
    }
  }
  return { main, wal, total: main + wal };
};

const asKinds = (kinds: Readonly<Record<string, number | undefined>>): DroppedKinds =>
  Object.fromEntries(Object.entries(kinds).filter(([, count]) => (count ?? 0) > 0)) as DroppedKinds;

const kindDeltas = (before: DroppedKinds, after: DroppedKinds): DroppedKinds => {
  const deltas: Record<string, number> = {};
  for (const kind of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const delta = (after[kind] ?? 0) - (before[kind] ?? 0);
    if (delta > 0) deltas[kind] = delta;
  }
  return deltas;
};

const percentCpu = (seconds: number, intervalMs: number) => (intervalMs <= 0 ? 0 : (100 * seconds) / (intervalMs / 1_000));
const mean = (values: ReadonlyArray<number>) =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function sourceHashes(): Record<string, string> {
  return Object.fromEntries(
    [...new Bun.Glob('**/*.ts').scanSync({ cwd: import.meta.dir })].sort().map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(join(import.meta.dir, name)))
        .digest('hex'),
    ]),
  );
}

const run = Effect.fnUntraced(function* (path: string, options: RunOptions, sources: Record<string, string>) {
  const store = yield* PerformanceStore;
  const reader = yield* PerformanceStoreReader;
  while (store.diagnostics().state === 'starting') yield* Effect.sleep(5);
  const opened = store.diagnostics();
  if (opened.state !== 'ready') {
    return yield* fail(
      `the store did not open its file: state ${opened.state} · restarts ${opened.restarts} · ${opened.lastError ?? 'no error reported'}`,
    );
  }

  const monitor = (): ReturnType<typeof monitorEventLoopDelay> => monitorEventLoopDelay({ resolution: LOOP_DELAY_RESOLUTION_MS });
  const minuteMonitor = yield* Effect.acquireRelease(Effect.sync(monitor), (held) => Effect.sync(() => held.disable()));
  const holdMonitor = yield* Effect.acquireRelease(Effect.sync(monitor), (held) => Effect.sync(() => held.disable()));
  const readLoop = (held: ReturnType<typeof monitorEventLoopDelay>): LoopReading => ({
    count: held.count,
    p50Ms: held.percentile(50) / 1_000_000,
    p99Ms: held.percentile(99) / 1_000_000,
    maxMs: held.max / 1_000_000,
  });

  const observe = Effect.fnUntraced(function* (loopDelay: LoopReading | null) {
    const threads = yield* attemptAsync(() => readThreads(process.pid));
    const cpuUsage = process.cpuUsage();
    const atMs = performance.now();
    const bytes = yield* attempt(() => fileBytes(path));
    const diagnostics = store.diagnostics();
    const losses = yield* reader.read({ type: 'losses', source: 'live', limit: 1 });
    if (losses._tag !== 'Found' || losses.report.type !== 'losses') return yield* fail('the live losses page is unavailable');
    const snapshot: Snapshot = {
      atMs,
      threads,
      cpuUsage,
      loopDelay,
      fileBytes: bytes.total,
      mainFileBytes: bytes.main,
      walBytes: bytes.wal,
      state: diagnostics.state,
      restarts: diagnostics.restarts,
      lastError: diagnostics.lastError,
      pendingRecords: diagnostics.pendingRecords,
      pendingBytes: diagnostics.pendingBytes,
      peakPendingBytes: diagnostics.peakPendingBytes,
      dropCount: diagnostics.dropCount,
      evictedSegments: diagnostics.evictedSegments,
      lastEvictionMs: diagnostics.lastEvictionMs,
      uncertainRecords: diagnostics.uncertainRecords,
      persistedRecords: losses.report.pressure.persistedRecords,
      sessionDrops: losses.report.sessionDrops,
      sessionDroppedKinds: asKinds(losses.report.sessionDroppedKinds),
    };
    return snapshot;
  });

  const sample = Effect.fnUntraced(function* () {
    minuteMonitor.disable();
    holdMonitor.disable();
    const reading = readLoop(minuteMonitor);
    const snapshot = yield* observe(reading);
    minuteMonitor.reset();
    minuteMonitor.enable();
    holdMonitor.enable();
    if (snapshot.state !== 'ready')
      return yield* fail(`the store is ${snapshot.state} while the instrument ran: ${snapshot.lastError ?? 'no error reported'}`);
    return snapshot;
  });

  const source = recordSource(randomUUID(), () => store.pressure());
  const plan = mixPlan();
  const running = yield* Ref.make(true);
  const submitted = yield* Ref.make(0);
  const pacer = Effect.gen(function* () {
    const startedAt = performance.now();
    while (yield* Ref.get(running)) {
      const due = Math.floor(((performance.now() - startedAt) / 1_000) * options.rate);
      const already = yield* Ref.get(submitted);
      const owed = Math.min(Math.max(0, due - already), options.rate);
      for (let index = 0; index < owed; index += 1) {
        const ordinal = already + index;
        store.submit(source.submission(plan[ordinal % plan.length]!, ordinal));
      }
      if (owed > 0) yield* Ref.set(submitted, already + owed);
      yield* Effect.sleep(TICK_MS);
    }
  });
  yield* Effect.forkScoped(pacer);

  let previous = yield* observe(null);
  const fillStartedAt = performance.now();
  while (previous.fileBytes < options.boundBytes) {
    yield* Effect.sleep(FILL_REPORT_MS);
    const current = yield* observe(null);
    if (current.state !== 'ready')
      return yield* fail(`the store is ${current.state} during the fill: ${current.lastError ?? 'no error reported'}`);
    const intervalMs = current.atMs - previous.atMs;
    const records = yield* Ref.get(submitted);
    const grownBytes = current.fileBytes - previous.fileBytes;
    const perSecond = grownBytes / (intervalMs / 1_000);
    console.log(
      JSON.stringify({
        type: 'fill',
        elapsedMs: Math.round(current.atMs - fillStartedAt),
        intervalMs: Math.round(intervalMs),
        fileBytes: { main: current.mainFileBytes, wal: current.walBytes, bound: options.boundBytes },
        submitted: records,
        processCpuPct: round(
          percentCpu(
            (current.cpuUsage.user + current.cpuUsage.system - previous.cpuUsage.user - previous.cpuUsage.system) / 1_000_000,
            intervalMs,
          ),
        ),
        processCpuPctOverFill: round(
          percentCpu((current.cpuUsage.user + current.cpuUsage.system) / 1_000_000, current.atMs - fillStartedAt),
        ),
        persisted: current.persistedRecords,
        persistedDelta: current.persistedRecords - previous.persistedRecords,
        dropCount: current.dropCount,
        droppedDelta: current.sessionDrops - previous.sessionDrops,
        projectedSecondsToBound: perSecond > 0 ? Math.max(0, Math.round((options.boundBytes - current.fileBytes) / perSecond)) : null,
        pendingRecords: current.pendingRecords,
      }),
    );
    previous = current;
  }
  const fillMs = previous.atMs - fillStartedAt;
  const fillRecords = yield* Ref.get(submitted);
  console.log(
    JSON.stringify({
      type: 'bound-crossed',
      fillMs: Math.round(fillMs),
      fillMinutes: round(fillMs / 60_000),
      fileBytes: { main: previous.mainFileBytes, wal: previous.walBytes, bound: options.boundBytes },
      recordsSubmitted: fillRecords,
      recordsPerSecond: round(fillRecords / (fillMs / 1_000), 1),
      persistedAtCrossing: previous.persistedRecords,
      diskBytesPerRecord: previous.persistedRecords === 0 ? null : round(previous.fileBytes / previous.persistedRecords, 1),
      processCpuPctOverFill: round(percentCpu((previous.cpuUsage.user + previous.cpuUsage.system) / 1_000_000, fillMs)),
      dropCount: previous.dropCount,
    }),
  );

  holdMonitor.reset();
  holdMonitor.enable();
  const holdStart = yield* sample();
  const holdStartedAt = holdStart.atMs;
  const samples = Math.max(1, Math.round(options.holdMinutes));
  const intervalMs = (options.holdMinutes * 60_000) / samples;
  const minutes: Array<Record<string, unknown>> = [];
  const evictions: Array<number> = [];
  let previousSubmitted = yield* Ref.get(submitted);
  for (let minute = 1; minute <= samples; minute += 1) {
    yield* Effect.sleep(Math.max(0, holdStartedAt + minute * intervalMs - performance.now()));
    const snapshot = yield* sample();
    const elapsedMs = snapshot.atMs - previous.atMs;
    const recordsSubmitted = yield* Ref.get(submitted);
    const { deltas, freshRows } = threadDeltas(previous.threads.threadSeconds, snapshot.threads.threadSeconds);
    const ranked = [...deltas].sort((left, right) => right - left);
    const processSeconds =
      (snapshot.cpuUsage.user + snapshot.cpuUsage.system - previous.cpuUsage.user - previous.cpuUsage.system) / 1_000_000;
    const line = {
      type: 'minute',
      minute,
      intervalMs: Math.round(elapsedMs),
      workerCpuPct: round(percentCpu(ranked[0] ?? 0, elapsedMs)),
      secondThreadCpuPct: round(percentCpu(ranked[1] ?? 0, elapsedMs)),
      threadsCpuPct: round(
        percentCpu(
          deltas.reduce((total, seconds) => total + seconds, 0),
          elapsedMs,
        ),
      ),
      mainThreadCpuPct: round(percentCpu(snapshot.threads.mainSeconds - previous.threads.mainSeconds, elapsedMs)),
      processCpuPct: round(percentCpu(processSeconds, elapsedMs)),
      threadDeltasMs: deltas.map((seconds) => Math.round(seconds * 1_000)),
      threads: {
        rows: snapshot.threads.threadSeconds.length,
        before: previous.threads.threadSeconds.length,
        freshRows,
        unparsed: snapshot.threads.unparsed,
      },
      loopDelay:
        snapshot.loopDelay === null
          ? null
          : {
              count: snapshot.loopDelay.count,
              p50Ms: round(snapshot.loopDelay.p50Ms, 3),
              p99Ms: round(snapshot.loopDelay.p99Ms, 3),
              maxMs: round(snapshot.loopDelay.maxMs, 3),
            },
      fileBytes: { main: snapshot.mainFileBytes, wal: snapshot.walBytes, bound: options.boundBytes },
      fileGrowthBytesPerMinute: Math.round((snapshot.fileBytes - previous.fileBytes) / (elapsedMs / 60_000)),
      records: {
        submitted: recordsSubmitted - previousSubmitted,
        submittedTotal: recordsSubmitted,
        persisted: snapshot.persistedRecords,
        persistedDelta: snapshot.persistedRecords - previous.persistedRecords,
        droppedDelta: snapshot.sessionDrops - previous.sessionDrops,
        droppedByKind: kindDeltas(previous.sessionDroppedKinds, snapshot.sessionDroppedKinds),
        droppedTotalByKind: snapshot.sessionDroppedKinds,
      },
      store: {
        state: snapshot.state,
        pendingRecords: snapshot.pendingRecords,
        pendingBytes: snapshot.pendingBytes,
        peakPendingBytes: snapshot.peakPendingBytes,
        dropCount: snapshot.dropCount,
        evictedSegments: snapshot.evictedSegments,
        lastEvictionMs: snapshot.lastEvictionMs,
        uncertainRecords: snapshot.uncertainRecords,
        restarts: snapshot.restarts,
      },
    };
    console.log(JSON.stringify(line));
    minutes.push(line);
    if (snapshot.lastEvictionMs !== null) evictions.push(snapshot.lastEvictionMs);
    previous = snapshot;
    previousSubmitted = recordsSubmitted;
    source.setLoopDelay(snapshot.loopDelay ?? { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 });
  }

  yield* Ref.set(running, false);
  yield* Effect.sleep(TICK_MS * 2);
  const drained = yield* observe(null);
  const totals = yield* reader.read({ type: 'losses', source: 'live', limit: 1 });
  if (totals._tag !== 'Found' || totals.report.type !== 'losses') return yield* fail('the live losses page is unavailable');

  const workerPercentages = minutes.map((minute) => minute['workerCpuPct'] as number);
  const secondPercentages = minutes.map((minute) => minute['secondThreadCpuPct'] as number);
  const threadsPercentages = minutes.map((minute) => minute['threadsCpuPct'] as number);
  const processPercentages = minutes.map((minute) => minute['processCpuPct'] as number);
  const loopP99s = minutes
    .map((minute) => (minute['loopDelay'] as LoopReading | null)?.p99Ms ?? Number.NaN)
    .filter((value) => Number.isFinite(value));
  const worstIndex = workerPercentages.reduce((worst, value, index) => (value > (workerPercentages[worst] ?? 0) ? index : worst), 0);
  const holdMs = previous.atMs - holdStartedAt;
  const holdWide = previous.loopDelay;
  const summary = {
    type: 'summary',
    hold: {
      requestedMinutes: options.holdMinutes,
      samples: minutes.length,
      holdMs: Math.round(holdMs),
      submitted: previousSubmitted - fillRecords,
      persistedDelta: previous.persistedRecords - holdStart.persistedRecords,
      droppedDelta: previous.sessionDrops - holdStart.sessionDrops,
      droppedByKind: kindDeltas(holdStart.sessionDroppedKinds, previous.sessionDroppedKinds),
      drainedPersistedDelta: drained.persistedRecords - previous.persistedRecords,
      droppedTotalByKind: totals.report.sessionDroppedKinds,
    },
    workerCpuPct: {
      mean: round(mean(workerPercentages)),
      worst: round(workerPercentages[worstIndex] ?? 0),
      worstMinute: worstIndex + 1,
      perMinute: workerPercentages,
      underTwoPercentEveryMinute: workerPercentages.every((value) => value < 2),
    },
    secondThreadCpuPct: {
      mean: round(mean(secondPercentages)),
      worst: round(Math.max(0, ...secondPercentages)),
      perMinute: secondPercentages,
    },
    threadsCpuPct: {
      mean: round(mean(threadsPercentages)),
      worst: round(Math.max(0, ...threadsPercentages)),
      perMinute: threadsPercentages,
    },
    processCpuPct: {
      mean: round(mean(processPercentages)),
      worst: round(Math.max(0, ...processPercentages)),
      perMinute: processPercentages,
    },
    loopDelay: {
      perMinuteP99MeanMs: round(mean(loopP99s), 3),
      perMinuteP99WorstMs: round(Math.max(0, ...loopP99s), 3),
      perMinuteP99: loopP99s,
      holdWide:
        holdWide === null
          ? null
          : {
              count: holdWide.count,
              p50Ms: round(holdWide.p50Ms, 3),
              p99Ms: round(holdWide.p99Ms, 3),
              maxMs: round(holdWide.maxMs, 3),
            },
    },
    fileBytes: {
      start: holdStart.fileBytes,
      end: previous.fileBytes,
      bound: options.boundBytes,
      growthBytesPerMinute: Math.round((previous.fileBytes - holdStart.fileBytes) / (holdMs / 60_000)),
    },
    store: {
      state: previous.state,
      restarts: previous.restarts,
      uncertainRecords: previous.uncertainRecords,
      dropCount: previous.dropCount,
      pendingRecords: previous.pendingRecords,
    },
    evictionActMs: {
      last: previous.lastEvictionMs,
      worst: evictions.length === 0 ? null : round(Math.max(...evictions), 3),
      segments: previous.evictedSegments,
    },
    evictionNote:
      previous.evictedSegments === 0
        ? 'nothing was evicted during this run: the ring stayed under its bound'
        : 'the store times the whole tick inside the worker; the unlink syscall itself is inside it',
    sourcesStable: JSON.stringify(yield* attempt(sourceHashes)) === JSON.stringify(sources),
  };
  console.log(JSON.stringify(summary));
  console.log(
    [
      '',
      `hold ${options.holdMinutes} min · ${minutes.length} samples · ${summary.hold.submitted} records submitted · ${summary.hold.persistedDelta} persisted · ${summary.hold.droppedDelta} dropped`,
      `worker CPU ${summary.workerCpuPct.mean} % of one core mean · worst ${summary.workerCpuPct.worst} % (minute ${summary.workerCpuPct.worstMinute}) · under 2 % every minute: ${summary.workerCpuPct.underTwoPercentEveryMinute}`,
      `second thread ${summary.secondThreadCpuPct.mean} % mean (attribution margin) · all threads ${summary.threadsCpuPct.mean} % · process CPU ${summary.processCpuPct.mean} % mean, worst ${summary.processCpuPct.worst} %`,
      `loop delay per minute p99 ${summary.loopDelay.perMinuteP99MeanMs} ms mean · ${summary.loopDelay.perMinuteP99WorstMs} ms worst · hold-wide p50 ${summary.loopDelay.holdWide?.p50Ms ?? Number.NaN} p99 ${summary.loopDelay.holdWide?.p99Ms ?? Number.NaN} max ${summary.loopDelay.holdWide?.maxMs ?? Number.NaN} ms`,
      `file ${summary.fileBytes.start} → ${summary.fileBytes.end} bytes at a ${options.boundBytes} byte bound · ${summary.fileBytes.growthBytesPerMinute} bytes/min`,
      summary.evictionActMs.segments === 0
        ? 'eviction act: nothing was evicted — the ring stayed under its bound for the whole hold'
        : `eviction act: worst ${summary.evictionActMs.worst} ms · last ${round(summary.evictionActMs.last ?? 0, 3)} ms · ${summary.evictionActMs.segments} segments unlinked`,
      '',
    ].join('\n'),
  );
});

const program = Effect.gen(function* () {
  const options = yield* attempt(() => parameters(process.argv.slice(2)));
  const directory = yield* Effect.acquireRelease(
    attempt(() => mkdtempSync('/tmp/performance-bound-bench-')),
    (path) =>
      Effect.sync(() => {
        if (!options.keep) rmSync(path, { recursive: true, force: true });
      }),
  );
  const path = join(directory, 'performance.sqlite');
  const sources = yield* attempt(sourceHashes);
  const head = yield* attemptAsync(async () => {
    const child = await spawned(['git', 'rev-parse', 'HEAD']);
    return child.exitCode === 0 ? child.stdout.trim() : null;
  });
  console.log(
    JSON.stringify({
      type: 'conditions',
      startedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      pid: process.pid,
      bun: Bun.version,
      head,
      directory,
      path,
      holdMinutes: options.holdMinutes,
      boundBytes: options.boundBytes,
      rate: options.rate,
      mixCycle: MIX_CYCLE,
      rareKinds: Object.fromEntries(RARE_KINDS),
      traces: `one retention key per ${TRACE_SPANS} spans`,
      pendingBoundBytes: PENDING_BOUND_BYTES,
      sources,
      instrument:
        'ps -M <pid> per sample for the process threads; process.cpuUsage() for the process delta; monitorEventLoopDelay at 10 ms built as ProcessVitals builds its own; statSync for the file; the live losses page for persisted and dropped counts.',
      workerThread: `the busiest thread row of each sample, with the second busiest reported beside it as the attribution margin: at the bound the store's worker is the thread that works continuously. Rows are matched between samples by cumulative CPU, because the ps listing order moves.`,
      guards:
        "both loop-delay monitors are disabled across a sample, so the instrument's own pause (a ps spawn, a stat) never lands in the series it closes.",
      notMeasured:
        "records persisted by kind (the store counts persisted records in total only, and dropped ones by kind); the eviction act's duration (no public timing exists); a real ProcessVitals sampler is not bound.",
      load: 'Shared machine: other agents and desktop load uncontrolled.',
    }),
  );
  yield* run(path, options, sources).pipe(
    Effect.provide(
      performanceStoreLayer({
        path,
        instanceId: randomUUID(),
        maxPendingBytes: () => PENDING_BOUND_BYTES,
        maxStoredBytes: () => options.boundBytes,
      }),
    ),
    Effect.timeout(Duration.minutes(options.holdMinutes + 90)),
  );
  console.log(
    JSON.stringify({
      type: 'complete',
      endedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      kept: options.keep ? directory : null,
    }),
  );
});

await Effect.runPromise(
  Effect.scoped(program).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(
          JSON.stringify({ type: 'failed', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
        );
        process.exitCode = 1;
      }),
    ),
  ),
);
