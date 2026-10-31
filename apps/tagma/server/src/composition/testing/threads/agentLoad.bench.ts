import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { gcAndSweep, heapStats } from 'bun:jsc';
import { monitorEventLoopDelay, performance as nodePerformance } from 'node:perf_hooks';
import { loadavg, totalmem, cpus } from 'node:os';
import { watch } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import {
  ByteSize,
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Fiber,
  FiberSet,
  FileSystem,
  Metric,
  Option,
  Queue,
  Runtime,
  Schema,
  Stream,
} from 'effect';
import { CPU_PROFILE_CAPTURE_MAX_MS, cpuProfileArtifactSchema, stallSampling } from '@runlith/performance/CpuProfile';
import { CpuProfiles } from '@runlith/performance/CpuProfiles';
import { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { PerformanceStore } from '@runlith/performance/PerformanceStore';
import { threadSpokenMessageEvent } from '@runlith/agent/thread/events';
import type { FeedPosition } from '@runlith/agent/transcript/live';
import {
  CostLedger,
  CurrentCost,
  costLedgerLayer,
  costRootId,
  rootCost,
  type CostCursor,
  type CostRow,
} from '@runlith/performance/CostLedger';
import { WriterMetrics } from '@runlith/performance/WriterMetrics';
import type { PerformanceReportMeta, WriterMetricsReport } from '@runlith/performance/protocol/reports';
import type { SlowCursor, TraceCursor } from '@runlith/performance/protocol/queries';
import type { StoredSpanRecord } from '@runlith/performance/protocol/records';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { SHIPPED_HARNESSES } from '../../../external-harnesses/testing/builtin.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { DRIVERS, type DriverId } from '../../manifest.js';
import { NativeStorage, ThreadHarness, ThreadLive } from '../../../threads/contract/service/engine.js';
import type { ThreadsFeedEvent } from '../../../threads/contract/wire/list.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { makeDoorWorld } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { hostedChild } from './hostedChild.js';
import { loadFeeds } from './loadFeeds.js';

const gcMonitored = process.env.AGENT_LOAD_CHILD === '1';
if (gcMonitored) delete process.env.BUN_JSC_logGC;
process.env.RUNLITH_SQLITE_HOSTING = 'child';

const flag = (name: string, fallback: number, minimum: number): number => {
  const given = process.argv.find((value) => value.startsWith(`--${name}=`));
  const value = given === undefined ? fallback : Number(given.slice(name.length + 3));
  if (!Number.isFinite(value) || value < minimum) throw new Error(`--${name} must be at least ${minimum}`);
  return value;
};
const agents = flag('agents', 0, 0);
const seconds = flag('seconds', 60, 1);
const warm = flag('warm', 10, 0);
const rate = flag('rate', 1, 0.01);
const subscribers = flag('subscribers', 1, 0) !== 0;
const causalDetail = flag('causal-detail', 0, 0) !== 0;
const churn = flag('churn', 0, 0) !== 0;
const resultBytes = flag('result-bytes', 2048, 1);
const messageBytes = flag('message-bytes', 1024, 1);
const callsPerBoundary = flag('calls-per-boundary', 1, 1);
const history = flag('history', 100, 0);
const repositoryFiles = flag('repository-files', 1, 1);
const projects = flag('projects', 1, 1);
const parentSize = flag('parent-size', 25, 1);
const turnMin = flag('turn-min', 0, 0);
const turnMax = flag('turn-max', turnMin === 0 ? 0 : 50, 0);
const warmSnapshot = flag('warm-snapshot', 0, 0) !== 0;
const snapshotDirectory = process.argv.find((value) => value.startsWith('--snapshots='))?.slice('--snapshots='.length);
const cpuProfilePath = process.argv.find((value) => value.startsWith('--cpu-profile='))?.slice('--cpu-profile='.length);
if (!Number.isSafeInteger(agents)) throw new Error('--agents must be an integer');
if (![resultBytes, messageBytes, history, repositoryFiles, projects, parentSize, turnMin, turnMax].every(Number.isSafeInteger))
  throw new Error('payload sizes and fixture counts must be integers');
if (turnMax < turnMin || (turnMin === 0 && turnMax !== 0)) throw new Error('invalid finite-turn limits');
if (callsPerBoundary !== 1 && callsPerBoundary !== 8) throw new Error('--calls-per-boundary must be 1 or 8');
if (snapshotDirectory !== undefined && !isAbsolute(snapshotDirectory)) throw new Error('--snapshots must be an absolute directory');
if (cpuProfilePath !== undefined && !isAbsolute(cpuProfilePath)) throw new Error('--cpu-profile must be an absolute path');
if (cpuProfilePath !== undefined && (warm + seconds + 1) * 1000 > CPU_PROFILE_CAPTURE_MAX_MS)
  throw new Error(`--cpu-profile is limited to ${CPU_PROFILE_CAPTURE_MAX_MS} ms`);
if (warmSnapshot && snapshotDirectory === undefined) throw new Error('--warm-snapshot requires --snapshots');

class BenchRefused extends Data.TaggedError('BenchRefused')<{ readonly message: string }> {}

type Histogram = { readonly count: number; readonly sum: number; readonly buckets: readonly (readonly [number, number])[] };
const histograms = Effect.fn('agentLoad.histograms')(function* () {
  const rows = new Map<string, Histogram>();
  for (const metric of yield* Metric.snapshot) {
    if (metric.type === 'Histogram' && metric.attributes?.measure === 'duration') {
      rows.set(metric.id, { count: metric.state.count, sum: metric.state.sum, buckets: metric.state.buckets });
    }
  }
  return rows;
});

const histogramDelta = (name: string, before: Map<string, Histogram>, after: Map<string, Histogram>) => {
  const previous = before.get(name);
  const current = after.get(name);
  if (current === undefined) return null;
  const count = current.count - (previous?.count ?? 0);
  const percentile = (share: number) => {
    if (count === 0) return null;
    const target = Math.ceil(count * share);
    for (let index = 0; index < current.buckets.length; index += 1) {
      const [boundary, cumulative] = current.buckets[index]!;
      if (cumulative - (previous?.buckets[index]?.[1] ?? 0) >= target) return Number.isFinite(boundary) ? boundary : null;
    }
    return null;
  };
  return { count, sumMs: current.sum - (previous?.sum ?? 0), p50UpperMs: percentile(0.5), p99UpperMs: percentile(0.99) };
};

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const callSchema = Schema.fromJsonString(Schema.Struct({ toolCallId: Schema.String, name: Schema.String, input: Schema.Unknown }));
const probeSchema = Schema.fromJsonString(Schema.Struct({ id: Schema.Int, scheduledAt: Schema.Number, offeredAt: Schema.Number }));
const turnSchema = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal('prompt'), turn: Schema.Int, run: Schema.String, target: Schema.Int, at: Schema.Number }),
    Schema.Struct({
      type: Schema.Literal('sealed'),
      turn: Schema.Int,
      calls: Schema.Int,
      offered: Schema.Int,
      textBytes: Schema.Int,
      beganAt: Schema.Number,
      at: Schema.Number,
    }),
  ]),
);
const frameCountsSchema = Schema.Struct({ text: Schema.Number, toolStart: Schema.Number, status: Schema.Number, boundary: Schema.Number });
const progressSchema = Schema.fromJsonString(
  Schema.Struct({
    agent: Schema.String,
    recordedAt: Schema.String,
    emittedFrames: Schema.Number,
    frameCounts: frameCountsSchema,
    hostedAnnounced: Schema.Number,
    callsOffered: Schema.Number,
    turns: Schema.Number,
    turnsEnded: Schema.Number,
    callsInTurn: Schema.Number,
    turnTarget: Schema.Number,
    stdoutBufferedBytes: Schema.Number,
  }),
);
type Call = typeof callSchema.Type;
type Probe = typeof probeSchema.Type;
type ProbeJob = { readonly probe: Probe; readonly measured: boolean; readonly enqueuedAt?: bigint; readonly enqueuedWall?: number };
type ThreadProbeExample = {
  readonly id: number;
  readonly offeredAt: number;
  readonly subscribedAt: number;
  readonly receivedAt: number;
  readonly type: string;
};
type ListProbeExample = {
  readonly id: number;
  readonly offerToEnqueueMs: number;
  readonly queueMs: number;
  readonly initialMs: number;
  readonly titleMs: number;
  readonly waitMs: number;
  readonly holdMs: number;
  readonly commitToFrameMs: number;
  readonly receivedFromOfferMs: number;
};
type Turn = typeof turnSchema.Type;
type Agent = {
  readonly threadId: string;
  readonly report: string;
  completed: number;
  changed: Deferred.Deferred<void>;
  runId: string | null;
  expectedRunId: string | null;
  nextRun: Deferred.Deferred<void>;
  turnNumber: number;
  turnTarget: number;
  turnStartCompleted: number;
  inputBytes: number;
  outputBytes: number;
  turnStartInputBytes: number;
  turnStartOutputBytes: number;
  pendingTurn: { readonly sealedAt: number; readonly measured: boolean } | null;
  phase: 'priming' | 'starting' | 'active' | 'settling';
};
const COST_FIELDS = [
  'statements',
  'units',
  'programs',
  'programStatements',
  'statementMs',
  'statementExecMs',
  'writerHoldMs',
  'writerWaitMs',
  'requestBytes',
  'responseBytes',
  'spans',
] as const;
type CostField = (typeof COST_FIELDS)[number];
type CostFigure = { count: number; sum: number; max: number; readonly buckets: Map<number, number> };
const figure = (): CostFigure => ({ count: 0, sum: 0, max: 0, buckets: new Map() });
const addFigure = (held: CostFigure, value: number) => {
  const upper = value <= 1000 ? Math.ceil(value) : 2 ** Math.ceil(Math.log2(value));
  held.count += 1;
  held.sum += value;
  held.max = Math.max(held.max, value);
  held.buckets.set(upper, (held.buckets.get(upper) ?? 0) + 1);
};
const readFigure = (held: CostFigure) => {
  const ordered = [...held.buckets].sort((left, right) => left[0] - right[0]);
  const percentile = (share: number) => {
    let seen = 0;
    for (const [upper, count] of ordered) {
      seen += count;
      if (seen >= Math.ceil(held.count * share)) return upper;
    }
    return null;
  };
  return {
    count: held.count,
    mean: held.count === 0 ? null : held.sum / held.count,
    p50Upper: percentile(0.5),
    p99Upper: percentile(0.99),
    max: held.count === 0 ? null : held.max,
  };
};
type ProducerSums = {
  statements: number;
  units: number;
  programs: number;
  programStatements: number;
  writerHoldMs: number;
  writerWaitMs: number;
};
type CostGroup = {
  readonly fields: Record<CostField, CostFigure>;
  readonly ownUnits: CostFigure | null;
  readonly producers: Map<string, number>;
  readonly producerCosts: Map<string, ProducerSums> | null;
};
const costs = () => {
  const groups = new Map<string, CostGroup>();
  const addAs = (name: string, row: CostRow) => {
    let group = groups.get(name);
    if (group === undefined) {
      const fields = Object.fromEntries(COST_FIELDS.map((field) => [field, figure()])) as Record<CostField, CostFigure>;
      group = { fields, ownUnits: causalDetail ? figure() : null, producers: new Map(), producerCosts: causalDetail ? new Map() : null };
      groups.set(name, group);
    }
    for (const field of COST_FIELDS) addFigure(group.fields[field], row.total[field]);
    if (group.ownUnits !== null) addFigure(group.ownUnits, row.own.units);
    for (const producer of row.producers) {
      group.producers.set(producer.name, (group.producers.get(producer.name) ?? 0) + producer.counts.statements);
      if (group.producerCosts !== null) {
        const sum = group.producerCosts.get(producer.name) ?? {
          statements: 0,
          units: 0,
          programs: 0,
          programStatements: 0,
          writerHoldMs: 0,
          writerWaitMs: 0,
        };
        sum.statements += producer.counts.statements;
        sum.units += producer.counts.units;
        sum.programs += producer.counts.programs;
        sum.programStatements += producer.counts.programStatements;
        sum.writerHoldMs += producer.counts.writerHoldMs;
        sum.writerWaitMs += producer.counts.writerWaitMs;
        group.producerCosts.set(producer.name, sum);
      }
    }
  };
  const add = (row: CostRow) => {
    addAs(row.name, row);
    if (causalDetail && row.name === 'ProtocolSteps.run') {
      const saved = row.producers.find((producer) => producer.name === 'ProtocolSteps.saved');
      addAs(
        saved !== undefined && saved.counts.units + saved.counts.programs > 0 ? 'ProtocolSteps.run.saved' : 'ProtocolSteps.run.no-save',
        row,
      );
    }
  };
  const read = () =>
    Object.fromEntries(
      [...groups].map(([name, group]) => [
        name,
        {
          roots: group.fields.statements.count,
          figures: Object.fromEntries(COST_FIELDS.map((field) => [field, readFigure(group.fields[field])])),
          statementProducers: [...group.producers].sort((left, right) => right[1] - left[1]),
          ...(group.ownUnits === null || group.producerCosts === null
            ? {}
            : {
                ownUnits: readFigure(group.ownUnits),
                producerCosts: [...group.producerCosts]
                  .map(([name, sum]) => ({
                    name,
                    ...sum,
                    unitsPerRoot: sum.units / group.fields.units.count,
                    programsPerRoot: sum.programs / group.fields.programs.count,
                    programStatementsPerRoot: sum.programStatements / group.fields.programStatements.count,
                  }))
                  .sort((left, right) => right.units + right.programs - left.units - left.programs),
              }),
        },
      ]),
    );
  return { add, read };
};

type WriterReader = WriterMetrics['Service'];
type WriterOperation = WriterMetricsReport['rows'][number];
type WriterHistogram = WriterOperation['wait'];
const WRITER_FIELDS = ['wait', 'hold', 'child', 'outside'] as const;
type WriterField = (typeof WRITER_FIELDS)[number];

const writerSnapshot = (writers: WriterReader) => {
  const first = writers.metrics({ limit: 8 });
  const rows = [...first.rows];
  let next = first.next;
  let reset = first.reset;
  while (next !== null) {
    const page = writers.metrics({ after: next, limit: 8 });
    reset ||= page.reset || page.writerId !== first.writerId || page.cursor.sequence !== first.cursor.sequence;
    rows.push(...page.rows);
    next = page.next;
  }
  return { ...first, rows, reset };
};
type WriterSnapshot = ReturnType<typeof writerSnapshot>;

const writerFigure = (held: CostFigure, boundaries: readonly number[]) => {
  if (held.count === 0) return { count: 0, meanMs: null, p50: null, p99: null };
  const result = readFigure(held);
  const bound = (value: number | null) =>
    value === null ? null : Number.isFinite(value) ? { upperBoundMs: value } : { aboveMs: boundaries.at(-1) };
  return { count: held.count, meanMs: result.mean, p50: bound(result.p50Upper), p99: bound(result.p99Upper) };
};

const writerDelta = (before: WriterSnapshot, after: WriterSnapshot) => {
  const issues: string[] = [];
  if (before.reset || after.reset || before.writerId !== after.writerId) issues.push('writer-reset');
  if (before.boundariesMs.join(',') !== after.boundariesMs.join(',')) issues.push('boundaries-changed');
  if (after.evictedOperations !== before.evictedOperations) issues.push('operation-eviction');
  if (issues.includes('writer-reset') || issues.includes('boundaries-changed'))
    return {
      writerId: after.writerId,
      from: before.cursor,
      through: after.cursor,
      evictedOperations: null,
      partial: true,
      issues,
      totals: null,
      operations: [],
    };
  const previous = new Map(before.rows.map((row) => [row.operation, row]));
  const current = new Map(after.rows.map((row) => [row.operation, row]));
  const totals = Object.fromEntries(WRITER_FIELDS.map((field) => [field, figure()])) as Record<WriterField, CostFigure>;
  const rows: {
    readonly operation: string;
    readonly units: number;
    readonly failures: number;
    readonly interruptions: number;
    readonly incomplete: number;
    readonly figures: Record<WriterField, ReturnType<typeof writerFigure>>;
  }[] = [];
  for (const row of before.rows) if (!current.has(row.operation)) issues.push(`missing:${row.operation}`);
  for (const row of after.rows) {
    const prior = previous.get(row.operation);
    if (prior !== undefined && prior.series !== row.series) {
      issues.push(`series-changed:${row.operation}`);
      continue;
    }
    if (prior === undefined && row.sinceSequence <= before.cursor.sequence) {
      issues.push(`missing-origin:${row.operation}`);
      continue;
    }
    const delta = (name: WriterField) => {
      const now: WriterHistogram = row[name];
      const old = prior?.[name];
      const held = figure();
      held.count = now.count - (old?.count ?? 0);
      held.sum = now.sumMs - (old?.sumMs ?? 0);
      now.bucketCounts.forEach((count, index) =>
        held.buckets.set(after.boundariesMs[index] ?? Number.POSITIVE_INFINITY, count - (old?.bucketCounts[index] ?? 0)),
      );
      return held;
    };
    const figures = Object.fromEntries(WRITER_FIELDS.map((name) => [name, delta(name)])) as Record<WriterField, CostFigure>;
    if (
      row.count < (prior?.count ?? 0) ||
      row.failures < (prior?.failures ?? 0) ||
      row.interruptions < (prior?.interruptions ?? 0) ||
      row.incomplete < (prior?.incomplete ?? 0) ||
      WRITER_FIELDS.some(
        (name) =>
          figures[name].count < 0 ||
          [...figures[name].buckets.values()].some((count) => count < 0) ||
          [...figures[name].buckets.values()].reduce((sum, count) => sum + count, 0) !== figures[name].count,
      )
    ) {
      issues.push(`negative-delta:${row.operation}`);
      continue;
    }
    if (row.count === (prior?.count ?? 0)) continue;
    for (const name of WRITER_FIELDS) {
      totals[name].count += figures[name].count;
      totals[name].sum += figures[name].sum;
      for (const [bound, count] of figures[name].buckets) totals[name].buckets.set(bound, (totals[name].buckets.get(bound) ?? 0) + count);
    }
    rows.push({
      operation: row.operation,
      units: row.count - (prior?.count ?? 0),
      failures: row.failures - (prior?.failures ?? 0),
      interruptions: row.interruptions - (prior?.interruptions ?? 0),
      incomplete: row.incomplete - (prior?.incomplete ?? 0),
      figures: Object.fromEntries(WRITER_FIELDS.map((name) => [name, writerFigure(figures[name], after.boundariesMs)])) as Record<
        WriterField,
        ReturnType<typeof writerFigure>
      >,
    });
  }
  return {
    writerId: after.writerId,
    from: before.cursor,
    through: after.cursor,
    evictedOperations: after.evictedOperations - before.evictedOperations,
    partial: issues.length > 0,
    issues,
    totals: Object.fromEntries(WRITER_FIELDS.map((name) => [name, writerFigure(totals[name], after.boundariesMs)])),
    operations: rows.sort((left, right) => right.units - left.units),
  };
};

type Allocator = {
  readonly malloc_requested?: number;
  readonly committed?: { readonly current: number; readonly peak: number };
  readonly reserved?: { readonly current: number };
  readonly purged?: number;
};
const allocatorOf = (stats: ReturnType<typeof heapStats>): Allocator | undefined =>
  (stats as unknown as { readonly mimalloc?: Allocator }).mimalloc;
const jscReading = (stats: ReturnType<typeof heapStats>) => {
  const allocator = allocatorOf(stats);
  return {
    heapSize: stats.heapSize,
    heapCapacity: stats.heapCapacity,
    extraMemorySize: stats.extraMemorySize,
    objectCount: stats.objectCount,
    largestTypes: Object.entries(stats.objectTypeCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20),
    allocator:
      allocator === undefined
        ? null
        : {
            requestedBytes: allocator.malloc_requested,
            committedBytes: allocator.committed?.current,
            committedPeakBytes: allocator.committed?.peak,
            reservedBytes: allocator.reserved?.current,
            purgedBytes: allocator.purged,
          },
  };
};

const program = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const installation = yield* files.makeTempDirectoryScoped({ prefix: 'agent-load-cli-' });
  const oldPath = process.env.PATH;
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.PATH = `${installation}:${oldPath ?? ''}`;
    }),
    () =>
      Effect.sync(() => {
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
      }),
  );
  for (const command of [WORLD_COMMAND, ...SHIPPED_HARNESSES.map(({ binary }) => binary)].filter((name) => !isAbsolute(name))) {
    yield* files.writeFileString(join(installation, command), '#!/bin/sh\nprintf "fixture\\n"\n', { mode: 0o755 });
  }
  const world = yield* makeDoorWorld({ own: 'the load bench owns and closes its installation', drivers: [...DRIVERS] as DriverId[] });
  yield* world.runtime.openMaintenance;
  const context = yield* world.runtime.runtime.contextEffect;
  const runtimeWork = Effect.gen(function* () {
    yield* claudeLogin(world, { restore: false });
    yield* hostedDefaults(world);
    const checkout = yield* world.directory('load-project');
    yield* suiteGit(checkout, 'init', '-q', '-b', 'main');
    yield* files.makeDirectory(join(checkout, 'src'), { recursive: true });
    const fixtureLine = `fixture ${'x'.repeat(1000)}\n`;
    yield* files.writeFileString(
      join(checkout, 'src/fixture.ts'),
      fixtureLine.repeat(Math.ceil(resultBytes / fixtureLine.length)).slice(0, resultBytes),
    );
    for (let first = 1; first < repositoryFiles; first += 1000) {
      const directory = join(checkout, 'src', `group-${first}`);
      yield* files.makeDirectory(directory);
      const count = Math.min(1000, repositoryFiles - first);
      yield* Effect.forEach(
        Array.from({ length: count }, (_, index) => first + index),
        (index) => files.writeFileString(join(directory, `fixture-${index}.ts`), `export const value = ${index};\n`),
        { concurrency: 16, discard: true },
      );
    }
    yield* suiteGit(checkout, 'add', 'src');
    yield* suiteGit(checkout, 'commit', '-qm', 'bench fixture');
    const projectId = yield* world.stealthProject(checkout);
    for (let index = 1; index < projects; index += 1) yield* world.plainProject();
    yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
    const at = `project=${projectId}`;
    const roots = yield* world.op('list_root_blocks', {}, at);
    const root = (roots.body as { readonly blocks?: readonly { readonly name: string }[] }).blocks?.[0]?.name;
    if (roots.status !== 200 || root === undefined)
      return yield* new BenchRefused({ message: `no project root: ${JSON.stringify(roots)}` });
    const harness = Context.get(world.runtime.owners, ThreadHarness);
    const seedHistory = Effect.fn('agentLoad.seedHistory')(function* (threadId: string) {
      if (history === 0) return;
      const occurredAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      yield* harness.threads.handle(threadId, 'operator').append(
        Array.from({ length: history }, (_, index) =>
          threadSpokenMessageEvent({
            role: index % 2 === 0 ? 'user' : 'assistant',
            text: `Prior fixture message ${index}: a representative conversation entry.`,
            occurredAt,
          }),
        ),
      );
    });
    const observer = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'bypass' })).thread
      .id;
    yield* seedHistory(observer);
    const parents: string[] = [];
    for (let first = 0; first < agents; first += parentSize) {
      const parent = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'bypass' })).thread
        .id;
      yield* seedHistory(parent);
      parents.push(parent);
    }
    const born: Agent[] = [];
    const agentsByThread = new Map<string, Agent>();
    const producerFailure = yield* Effect.acquireRelease(Queue.unbounded<BenchRefused>(), Queue.shutdown);
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Context.get(world.runtime.owners, ThreadLive).subscribeStates((state) => {
          const agent = agentsByThread.get(state.thread.id);
          if (agent === undefined || state.activeRun !== null || state.status.ending == null) return;
          const ending = state.status.ending;
          if (
            (agent.phase === 'priming' && ending.status !== 'completed') ||
            ((agent.phase === 'starting' || agent.phase === 'active') &&
              (agent.expectedRunId === null || ending.runId === agent.expectedRunId))
          )
            Queue.offerUnsafe(
              producerFailure,
              new BenchRefused({ message: `producer ${agent.threadId} ended unexpectedly: ${JSON.stringify(ending)}` }),
            );
        }),
      ),
      (detach) => Effect.sync(detach),
    );
    const failOnProducer = Effect.flatMap(Queue.take(producerFailure), Effect.fail);
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        born,
        ({ threadId }) => {
          const thread = harness.threads.handle(threadId, 'operator');
          return Effect.andThen(thread.stop(), thread.release()).pipe(Effect.orDie);
        },
        { discard: true, concurrency: 'unbounded' },
      ),
    );
    const go = join(installation, 'go');
    const progressDirectory = join(installation, 'progress');
    yield* files.makeDirectory(progressDirectory);
    const cli = join(import.meta.dir, 'loadAgent.bench.ts');
    const waitFile = (path: string, agent: Agent) =>
      Effect.scoped(
        Effect.gen(function* () {
          const changed = yield* Queue.unbounded<void>();
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              watch(
                dirname(path),
                (_event, name) =>
                  void (name === null || String(name) === basename(path) ? Queue.offerUnsafe(changed, undefined) : undefined),
              ),
            ),
            (watcher) => Effect.sync(() => watcher.close()),
          );
          while (!(yield* files.exists(path))) {
            const state = yield* harness.reads.snapshot(agent.threadId);
            const ending = state.status.ending;
            if (
              state.activeRun === null &&
              ending != null &&
              (agent.phase === 'priming' || agent.expectedRunId === null || ending.runId === agent.expectedRunId) &&
              !(yield* files.exists(path))
            )
              return yield* new BenchRefused({
                message: `producer ${agent.threadId} ended before ${basename(path)}: ${JSON.stringify(ending)}`,
              });
            yield* Effect.raceFirst(Queue.take(changed), failOnProducer);
          }
        }),
      );
    const waitSettled = (threadId: string, runId?: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          const changed = yield* Queue.unbounded<void>();
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              Context.get(world.runtime.owners, ThreadLive).subscribeStates((state) => {
                if (state.thread.id === threadId) Queue.offerUnsafe(changed, undefined);
              }),
            ),
            (detach) => Effect.sync(detach),
          );
          for (;;) {
            const snapshot = yield* harness.reads.snapshot(threadId);
            const ending = snapshot.status.ending;
            if (snapshot.status.life === 'idle' && ending != null && (runId === undefined || ending.runId === runId)) {
              if (ending.status !== 'completed') return yield* new BenchRefused({ message: `run ${ending.runId} ended ${ending.status}` });
              if (ending.notification === 'confirmed') return;
            }
            yield* Effect.raceFirst(Queue.take(changed), failOnProducer);
          }
        }),
      );
    const primeChild = Effect.fn('agentLoad.primeChild')(function* (parent: string, index: number) {
      const id = `load-prime-${crypto.randomUUID()}`;
      const step = `load-agent-${index}`;
      const plan = {
        name: 'load-prime',
        description: 'Prime a finite-turn load agent.',
        input: {},
        revision: 'load-prime',
        steps: [{ kind: 'agent' as const, id: step, agentType: 'tagma', task: 'Prepare the load fixture.' }],
        transitions: [],
        entry: step,
      };
      const opened = yield* harness.workflows.start({ id, workflow: plan.name, plan, thread: parent, input: {} });
      if (!('status' in opened) || opened.status !== 'running')
        return yield* new BenchRefused({ message: `priming workflow did not open: ${JSON.stringify(opened)}` });
      const finished = yield* harness.workflows.advance(id);
      if (finished?.status !== 'completed')
        return yield* new BenchRefused({ message: `priming workflow did not complete: ${JSON.stringify(finished)}` });
      const child = yield* Context.get(world.runtime.owners, NativeStorage).threads.findNamed(parent, 'operator', step);
      if (child === undefined) return yield* new BenchRefused({ message: `primed child ${step} was not found` });
      return child.id;
    });
    const inputs = [
      ...Array.from({ length: 64 }, () => ({ name: 'read', input: { path: join(checkout, 'src/fixture.ts') } })),
      ...Array.from({ length: 15 }, () => ({ name: 'grep', input: { path: checkout, pattern: 'fixture', output_mode: 'content' } })),
      ...Array.from({ length: 10 }, () => ({
        name: 'bash',
        input: { command: `head -c ${resultBytes} /dev/zero | tr '\\000' x`, description: 'Produce the fixture output' },
      })),
      ...Array.from({ length: 3 }, () => ({ name: 'glob', input: { path: checkout, pattern: '**/*.ts' } })),
      ...Array.from({ length: 8 }, () => ({ name: 'read_block', input: { blockIds: [root] } })),
    ];
    for (let index = 0; index < agents; index += 1) {
      const report = join(installation, `agent-${index}`);
      const plan = join(installation, `plan-${index}.json`);
      yield* files.writeFileString(plan, JSON.stringify(Array.from({ length: 100 }, (_, step) => inputs[(step * 37 + index * 13) % 100])));
      yield* files.writeFileString(`${report}.calls`, '');
      yield* files.writeFileString(`${report}.turns`, '');
      const command = [
        process.execPath,
        cli,
        '--report',
        report,
        '--plan',
        plan,
        '--go',
        go,
        '--progress-dir',
        progressDirectory,
        '--rate',
        String(2.6 * rate),
        '--message-bytes',
        String(messageBytes),
        '--calls-per-boundary',
        String(callsPerBoundary),
        '--agent-index',
        String(index),
        '--turn-min',
        String(turnMin),
        '--turn-max',
        String(turnMax),
        '--phase',
        String((index * 10000) / agents / rate),
      ];
      if (turnMin > 0) command.push('--prime');
      if (index % 5 === 4) command.push('--idle');
      yield* files.writeFileString(join(installation, WORLD_COMMAND), `#!/bin/sh\nexec ${command.map(shellQuote).join(' ')}\n`, {
        mode: 0o755,
      });
      const parent = parents[Math.floor(index / parentSize)]!;
      const threadId = turnMin > 0 ? yield* primeChild(parent, index) : (yield* hostedChild(world, parent, 'HOLD the turn')).threadId;
      const agent: Agent = {
        threadId,
        report,
        completed: 0,
        changed: Deferred.makeUnsafe<void>(),
        runId: null,
        expectedRunId: null,
        nextRun: Deferred.makeUnsafe<void>(),
        turnNumber: 0,
        turnTarget: 0,
        turnStartCompleted: 0,
        inputBytes: 0,
        outputBytes: 0,
        turnStartInputBytes: 0,
        turnStartOutputBytes: 0,
        pendingTurn: null,
        phase: turnMin > 0 ? 'priming' : 'starting',
      };
      born.push(agent);
      agentsByThread.set(threadId, agent);
      if (turnMin > 0) {
        yield* waitFile(`${report}.primed`, agent);
        yield* waitSettled(threadId);
      }
      yield* seedHistory(threadId);
      if (turnMin > 0) {
        const started = yield* harness.threads.handle(threadId, 'operator').send('HOLD the turn');
        if (started.status !== 'started')
          return yield* new BenchRefused({ message: `operator turn did not start: ${JSON.stringify(started)}` });
        agent.expectedRunId = started.runId;
        agent.phase = 'starting';
      }
      yield* waitFile(`${report}.ready`, agent);
      const opened = yield* world.op('open_hosted_turn', {}, at, { [GRANT_HEADER]: grantFor(threadId) });
      const initial = opened.body as { readonly status?: string; readonly prompt?: string | null };
      if (opened.status !== 200 || initial.status !== 'opened' || (turnMin > 0 && initial.prompt == null))
        return yield* new BenchRefused({ message: `opening agent ${index}: ${JSON.stringify(opened)}` });
      const state = yield* harness.reads.snapshot(threadId);
      if (state.activeRun === null || (agent.expectedRunId !== null && state.activeRun.id !== agent.expectedRunId))
        return yield* new BenchRefused({ message: `producer ${threadId} is not running its opened turn` });
      agent.expectedRunId = state.activeRun.id;
      agent.phase = 'active';
    }
    const followed = born.length === 0 ? [observer] : born.map(({ threadId }) => threadId);
    const feeds = yield* loadFeeds(world.runtime, yield* world.directory('socket'), projectId, followed, subscribers);
    const scenario = churn
      ? yield* Effect.flatMap(
          Effect.promise(() => import('./loadChurn.js')),
          ({ loadChurn }) => loadChurn(world, feeds.client, projectId, checkout, installation),
        )
      : null;
    const events = yield* Effect.acquireRelease(Queue.unbounded<string>(), Queue.shutdown);
    const streams = yield* FiberSet.make<void, unknown>();
    const ledger = Context.get(world.runtime.owners, CostLedger);
    const probeCapacity = Math.max(
      4096,
      Math.ceil((warm + seconds + 10) * (born.filter((_agent, index) => index % 5 !== 4).length * 0.1 * rate + 0.5)),
    );
    const probeLedger = causalDetail ? yield* Effect.provide(CostLedger, costLedgerLayer({ capacity: probeCapacity })) : ledger;
    const writers = Context.get(world.runtime.owners, WriterMetrics);
    const aggregatedCosts = costs();
    let costStart = Number.POSITIVE_INFINITY;
    let costEnd = Number.POSITIVE_INFINITY;
    const costReader = (source: CostLedger['Service'], relevant: (row: CostRow) => boolean) => {
      const following = new Map<number, { readonly row: CostRow; readonly before: CostCursor }>();
      const initial = source.read({ limit: 4096 });
      let cursor: CostCursor = { ledgerId: initial.ledgerId, sequence: initial.rows.at(-1)?.sequence ?? 0 };
      let missedRoots = 0;
      let reset = false;
      const collect = (now: number) => {
        const earliest = following.size === 0 ? undefined : Math.min(...following.keys());
        const after = earliest === undefined ? cursor : following.get(earliest)!.before;
        const page = source.read({ after, limit: 4096 });
        reset ||= page.reset;
        const next = page.rows.find((row) => row.sequence > cursor.sequence);
        if (next !== undefined && next.sequence > cursor.sequence + 1) missedRoots += next.sequence - cursor.sequence - 1;
        let before = after;
        for (const row of page.rows) {
          if (
            relevant(row) &&
            (row.sequence > cursor.sequence || following.has(row.sequence)) &&
            row.startedAt >= costStart &&
            row.startedAt < costEnd
          ) {
            if (row.endedAt === null || now - row.endedAt < 5000) following.set(row.sequence, { row, before });
            else {
              aggregatedCosts.add(row);
              following.delete(row.sequence);
            }
          }
          if (row.sequence > cursor.sequence) cursor = { ledgerId: page.ledgerId, sequence: row.sequence };
          before = { ledgerId: page.ledgerId, sequence: row.sequence };
        }
        for (const sequence of following.keys()) {
          if (page.rows.length > 0 && sequence < page.rows[0]!.sequence) {
            missedRoots += 1;
            following.delete(sequence);
          }
        }
      };
      const reading = () => ({
        evicted: source.read({ limit: 1 }).evicted - initial.evicted,
        reset,
        missedRoots,
        stillFollowing: following.size,
      });
      return { collect, reading };
    };
    const globalCosts = costReader(
      ledger,
      (row) =>
        row.name.startsWith('ProtocolSteps.') ||
        row.name.startsWith('TerminalEndings.') ||
        row.name === 'CommandDelivery.drive' ||
        row.name === 'FreshnessGate.refresh' ||
        row.name.startsWith('bench.turn.') ||
        (!causalDetail && row.name.startsWith('bench.hosted.')),
    );
    const probeCosts = causalDetail ? costReader(probeLedger, () => true) : null;
    const collectCosts = (now: number) => {
      globalCosts.collect(now);
      probeCosts?.collect(now);
    };
    const calls = new Map<string, { readonly agent: Agent; readonly file: FileSystem.File; pending: string }>();
    const turns = new Map<string, { readonly agent: Agent; readonly file: FileSystem.File; pending: string }>();
    for (const agent of born) {
      calls.set(`${basename(agent.report)}.calls`, { agent, file: yield* files.open(`${agent.report}.calls`, { flag: 'r' }), pending: '' });
      if (turnMin > 0)
        turns.set(`${basename(agent.report)}.turns`, {
          agent,
          file: yield* files.open(`${agent.report}.turns`, { flag: 'r' }),
          pending: '',
        });
    }
    const probePath = join(installation, 'interface.events');
    yield* files.writeFileString(probePath, '');
    const probeFile = yield* files.open(probePath, { flag: 'r' });
    const probes = yield* Effect.acquireRelease(Queue.unbounded<Probe | 'drain'>(), Queue.shutdown);
    const probeDrained = yield* Deferred.make<void>();
    let probeTarget: bigint | null = null;
    let probePending = '';
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        watch(installation, (_event, name) => {
          if (name === null) {
            for (const entry of calls.keys()) Queue.offerUnsafe(events, entry);
            for (const entry of turns.keys()) Queue.offerUnsafe(events, entry);
            Queue.offerUnsafe(events, 'interface.events');
          } else if (String(name) === 'interface.events' || calls.has(String(name)) || turns.has(String(name)))
            Queue.offerUnsafe(events, String(name));
        }),
      ),
      (watcher) => Effect.sync(() => watcher.close()),
    );
    let endingProbe = false;
    const probeProcess = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          Bun.spawn(
            [process.execPath, join(import.meta.dir, 'loadProbe.bench.ts'), '--go', go, '--report', probePath, '--interval', '2000'],
            { stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' },
          ),
        catch: (cause) => new BenchRefused({ message: `interface producer did not start: ${String(cause)}` }),
      }),
      (child) =>
        Effect.promise(async () => {
          endingProbe = true;
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          await child.exited;
        }),
    );
    yield* FiberSet.run(
      streams,
      Effect.gen(function* () {
        const code = yield* Effect.promise(() => probeProcess.exited);
        if (!endingProbe) return yield* new BenchRefused({ message: `interface producer exited ${code}` });
      }),
    );
    let submitted = 0;
    let completed = 0;
    let failed = 0;
    const failures: string[] = [];
    const deliveredSizes = new Map<string, number>();
    const invoke = Effect.fn('agentLoad.invoke')(function* (agent: Agent, call: Call) {
      submitted += 1;
      if (turnMin > 0) agent.inputBytes += Buffer.byteLength(JSON.stringify(call.input));
      const callRoot = rootCost(
        `bench.hosted.${call.name}`,
        world.op('call_hosted_tool', call, at, { [GRANT_HEADER]: grantFor(agent.threadId) }),
        `${agent.threadId}:${call.toolCallId}`,
      );
      const answer = yield* causalDetail ? callRoot.pipe(Effect.provideService(CostLedger, probeLedger)) : callRoot;
      const body = answer.body as {
        readonly status?: string;
        readonly failed?: boolean;
        readonly code?: string;
        readonly content?: readonly { readonly type: string; readonly text?: string }[];
      };
      if (turnMin > 0 || (body.status === 'called' && body.failed !== true && !deliveredSizes.has(call.name))) {
        const outputBytes = (body.content ?? []).reduce(
          (sum, part) => sum + (part.type === 'text' ? Buffer.byteLength(part.text ?? '') : 0),
          0,
        );
        if (turnMin > 0) agent.outputBytes += outputBytes;
        if (body.status === 'called' && body.failed !== true && !deliveredSizes.has(call.name)) deliveredSizes.set(call.name, outputBytes);
      }
      if (answer.status !== 200 || body.status !== 'called' || body.failed === true) {
        failed += 1;
        if (failures.length < 10) failures.push(JSON.stringify({ name: call.name, status: answer.status, body: answer.body }));
      }
      completed += 1;
      agent.completed += 1;
      const changed = agent.changed;
      agent.changed = Deferred.makeUnsafe<void>();
      yield* Deferred.succeed(changed, undefined);
    });
    const turnFigures = () => ({
      calls: figure(),
      textBytes: figure(),
      inputBytes: figure(),
      outputBytes: figure(),
      durationMs: figure(),
      pauseMs: figure(),
    });
    const allTurns = turnFigures();
    const measuredTurns = turnFigures();
    let openedTurns = 0;
    let settledTurns = 0;
    const handlingTurn = Effect.fn('agentLoad.turn')(function* (agent: Agent, event: Turn) {
      if (event.type === 'prompt') {
        if (event.turn > 1) {
          yield* Deferred.await(agent.nextRun);
          agent.nextRun = Deferred.makeUnsafe<void>();
        }
        if (event.turn !== agent.turnNumber + 1 || event.run === agent.runId || event.run !== agent.expectedRunId)
          return yield* new BenchRefused({ message: `agent opened an unexpected run: ${JSON.stringify(event)}` });
        if (event.turn > 1) {
          const prior = agent.pendingTurn;
          if (prior === null)
            return yield* new BenchRefused({ message: `agent opened a turn before its previous run settled: ${event.turn}` });
          const snapshot = yield* harness.reads.snapshot(agent.threadId);
          if (snapshot.activeRun?.id !== event.run)
            return yield* new BenchRefused({ message: `agent's active run differs from the prompt: ${JSON.stringify(event)}` });
          const opened = yield* rootCost(
            'bench.turn.open',
            world.op('open_hosted_turn', {}, at, { [GRANT_HEADER]: grantFor(agent.threadId) }),
          );
          const body = opened.body as { readonly status?: string; readonly prompt?: string | null };
          if (opened.status !== 200 || body.status !== 'opened' || body.prompt == null)
            return yield* new BenchRefused({ message: `opening a later turn: ${JSON.stringify(opened)}` });
          const pause = (yield* Clock.currentTimeMillis) - prior.sealedAt;
          addFigure(allTurns.pauseMs, pause);
          if (prior.measured) addFigure(measuredTurns.pauseMs, pause);
          agent.pendingTurn = null;
          yield* files.writeFileString(`${agent.report}.continue`, String(event.turn));
        }
        agent.runId = event.run;
        agent.turnNumber = event.turn;
        agent.turnTarget = event.target;
        agent.turnStartCompleted = agent.completed;
        agent.turnStartInputBytes = agent.inputBytes;
        agent.turnStartOutputBytes = agent.outputBytes;
        agent.phase = 'active';
        openedTurns += 1;
        return;
      }
      if (
        event.turn !== agent.turnNumber ||
        agent.runId === null ||
        agent.pendingTurn !== null ||
        event.calls !== agent.turnTarget ||
        event.offered !== agent.turnStartCompleted + event.calls
      )
        return yield* new BenchRefused({ message: `agent sealed an unexpected turn: ${JSON.stringify(event)}` });
      while (agent.completed < event.offered) {
        const changed = agent.changed;
        if (agent.completed < event.offered) yield* Deferred.await(changed);
      }
      agent.phase = 'settling';
      yield* files.writeFileString(`${agent.report}.end-turn`, String(event.turn));
      yield* waitSettled(agent.threadId, agent.runId);
      const endedAt = yield* Clock.currentTimeMillis;
      const measured = endedAt >= costStart && endedAt < costEnd;
      for (const target of measured ? [allTurns, measuredTurns] : [allTurns]) {
        addFigure(target.calls, event.calls);
        addFigure(target.textBytes, event.textBytes);
        addFigure(target.inputBytes, agent.inputBytes - agent.turnStartInputBytes);
        addFigure(target.outputBytes, agent.outputBytes - agent.turnStartOutputBytes);
        addFigure(target.durationMs, endedAt - event.beganAt);
      }
      settledTurns += 1;
      agent.pendingTurn = { sealedAt: event.at, measured };
      const started = yield* rootCost(
        'bench.turn.input',
        harness.threads.handle(agent.threadId, 'operator').send('Continue the load fixture.'),
      );
      if (started.status !== 'started')
        return yield* new BenchRefused({ message: `the next turn did not start: ${JSON.stringify(started)}` });
      agent.expectedRunId = started.runId;
      agent.phase = 'starting';
      yield* Deferred.succeed(agent.nextRun, undefined);
    });
    yield* FiberSet.run(
      streams,
      Effect.forever(
        Effect.gen(function* () {
          const name = yield* Queue.take(events);
          if (name === 'interface.events') {
            for (;;) {
              const bytes = yield* probeFile.readAlloc(65536);
              if (Option.isNone(bytes)) break;
              probePending += new TextDecoder().decode(bytes.value);
              let newline = probePending.indexOf('\n');
              while (newline >= 0) {
                const line = probePending.slice(0, newline);
                probePending = probePending.slice(newline + 1);
                if (line !== '') yield* Queue.offer(probes, yield* Schema.decodeUnknownEffect(probeSchema)(line));
                newline = probePending.indexOf('\n');
              }
            }
            if (probeTarget !== null && (yield* probeFile.seek(0n, 'current')) >= probeTarget) {
              probeTarget = null;
              yield* Queue.offer(probes, 'drain');
            }
            return;
          }
          const turn = turns.get(name);
          if (turn !== undefined) {
            for (;;) {
              const bytes = yield* turn.file.readAlloc(65536);
              if (Option.isNone(bytes)) break;
              turn.pending += new TextDecoder().decode(bytes.value);
              let newline = turn.pending.indexOf('\n');
              while (newline >= 0) {
                const line = turn.pending.slice(0, newline);
                turn.pending = turn.pending.slice(newline + 1);
                if (line !== '')
                  yield* FiberSet.run(streams, handlingTurn(turn.agent, yield* Schema.decodeUnknownEffect(turnSchema)(line)));
                newline = turn.pending.indexOf('\n');
              }
            }
            return;
          }
          const held = calls.get(name);
          if (held === undefined) return;
          for (;;) {
            const bytes = yield* held.file.readAlloc(65536);
            if (Option.isNone(bytes)) break;
            held.pending += new TextDecoder().decode(bytes.value);
            let newline = held.pending.indexOf('\n');
            while (newline >= 0) {
              const line = held.pending.slice(0, newline);
              held.pending = held.pending.slice(newline + 1);
              if (line !== '') yield* FiberSet.run(streams, invoke(held.agent, yield* Schema.decodeUnknownEffect(callSchema)(line)));
              newline = held.pending.indexOf('\n');
            }
          }
        }),
      ),
    );
    for (const name of turns.keys()) yield* Queue.offer(events, name);
    const snapshot = Effect.fn('agentLoad.snapshot')(function* (label: string, analyze = true) {
      yield* Effect.sync(() => {
        if (gcMonitored && label === 'before') process.stderr.write('AGENT_LOAD_GC_IDENTIFY_BEGIN\n');
        gcAndSweep();
        if (gcMonitored && label === 'before') process.stderr.write('AGENT_LOAD_GC_IDENTIFY_END\n');
      });
      const at = yield* Clock.currentTimeMillis;
      const callsAt = { submitted, completed };
      const memory = process.memoryUsage();
      const jsc = jscReading(heapStats());
      if (snapshotDirectory === undefined) return { at, callsAt, memory, jsc, retainers: null, file: null };
      yield* files.makeDirectory(snapshotDirectory, { recursive: true });
      const captured = yield* Context.get(world.runtime.measurement, HeapSnapshots).capture({ requestedBy: 'agent-load-bench' });
      const destination = join(snapshotDirectory, `${label}-${agents}.heapsnapshot`);
      yield* files.copy(captured.file, destination);
      const retainers = analyze
        ? yield* Effect.flatMap(
            Effect.promise(() => import('./loadRetainers.js')),
            ({ loadRetainers }) =>
              Effect.tryPromise({
                try: (signal) => loadRetainers(destination, 20, signal),
                catch: (cause) => new BenchRefused({ message: `heap retainer analysis failed: ${String(cause)}` }),
              }),
          )
        : null;
      return { at, callsAt, memory, jsc, retainers, file: destination };
    });
    const idle = yield* snapshot('before', !warmSnapshot);
    yield* FiberSet.run(
      streams,
      Effect.forever(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* Effect.sync(() => collectCosts(now));
          yield* Effect.sleep(1000);
        }),
      ),
    );
    const graphLatency = figure();
    const threadLatency = figure();
    const listLatency = figure();
    const listOfferedLatency = figure();
    const diagnosticStages = causalDetail
      ? {
          listQueueDelay: figure(),
          offerToListEnqueue: figure(),
          listInitialFrame: figure(),
          listTitleRequest: figure(),
          listWriterWait: figure(),
          listWriterHold: figure(),
          threadDispatchDelay: figure(),
          threadSubscribeToFrame: figure(),
          threadExamples: [] as ThreadProbeExample[],
          listExamples: [] as ListProbeExample[],
        }
      : null;
    const listEvidence = {
      gap: 0,
      reset: 0,
      missing: 0,
      ambiguous: 0,
      noCommit: 0,
      negative: 0,
      evictedDuringProbe: 0,
      writerPids: new Set<number>(),
    };
    const producerDelay = figure();
    let probesOffered = 0;
    let firstProbeAt: number | null = null;
    const completedBeforeCut = { graph: 0, thread: 0, list: 0 };
    const completedAfterCut = { graph: 0, thread: 0, list: 0 };
    const openings = { snapshot: 0, resume: 0 };
    let threadCursor: FeedPosition | undefined;
    let titleIndex = 0;
    const sampleList = Effect.fn('agentLoad.listBoundary')(function* () {
      const startedAt = causalDetail ? yield* Clock.monotonicTimeNanos : null;
      const frames = yield* Queue.unbounded<{ readonly frame: ThreadsFeedEvent; readonly received: number }>();
      const listener = yield* Effect.forkScoped(
        Stream.runForEach(feeds.client['threads.subscribe']({ projectId }), (frame) =>
          Queue.offer(frames, { frame, received: performance.timeOrigin + performance.now() }).pipe(Effect.asVoid),
        ),
      );
      const receive = Effect.raceFirst(Queue.take(frames), Effect.andThen(Fiber.join(listener), Effect.die('the list subscription ended')));
      yield* receive;
      const initialAt = causalDetail ? yield* Clock.monotonicTimeNanos : null;
      const title = `load probe ${++titleIndex}`;
      const before = writers.units({ limit: 1 });
      const listRoot = rootCost(
        'bench.list',
        Effect.gen(function* () {
          const cause = yield* CurrentCost;
          if (cause === null) return yield* new BenchRefused({ message: 'the list probe has no ledger cause' });
          const rootId = costRootId(cause);
          const answer = yield* world.op('set_thread_title', { threadId: observer, title }, at);
          return { answer, rootId };
        }),
      );
      const changed = yield* causalDetail ? listRoot.pipe(Effect.provideService(CostLedger, probeLedger)) : listRoot;
      if (changed.answer.status !== 200 || (changed.answer.body as { status?: string }).status !== 'loaded')
        return yield* new BenchRefused({ message: `list probe title: ${JSON.stringify(changed.answer)}` });
      const answeredAt = causalDetail ? yield* Clock.monotonicTimeNanos : null;
      for (;;) {
        const { frame, received } = yield* receive;
        const matched =
          frame.type === 'row'
            ? frame.row.id === observer && frame.row.title === title
            : frame.type === 'list' && frame.rows.some((row) => row.id === observer && row.title === title);
        if (!matched) continue;
        const page = writers.units({ rootId: changed.rootId, operation: 'ThreadAdjustments.setTitle', after: before.cursor, limit: 64 });
        const row = page.rows.length === 1 && page.next === null ? page.rows[0]! : null;
        return {
          gap: page.gap,
          reset: page.reset,
          evicted: page.evicted - before.evicted,
          rows: page.rows.length,
          more: page.next !== null,
          outcome: row?.outcome ?? null,
          writerPid: row?.writerPid ?? null,
          elapsedMs: row?.commitReturnedAt == null ? null : received - row.commitReturnedAt,
          ...(causalDetail
            ? {
                writerWaitMs: row?.waitMs ?? null,
                writerHoldMs: row?.holdMs ?? null,
                initialFrameMs: initialAt === null || startedAt === null ? null : Number(initialAt - startedAt) / 1_000_000,
                titleRequestMs: answeredAt === null || initialAt === null ? null : Number(answeredAt - initialAt) / 1_000_000,
                receivedAt: received,
              }
            : {}),
        };
      }
    }, Effect.scoped);
    const listJobs = yield* Effect.acquireRelease(Queue.unbounded<ProbeJob>(), Queue.shutdown);
    const finished = Effect.fn('agentLoad.probeFinished')(function* (
      kind: 'graph' | 'thread' | 'list',
      job: ProbeJob,
      latency: CostFigure,
    ) {
      if (!job.measured) return;
      const probe = job.probe;
      const now = yield* Clock.currentTimeMillis;
      if (now - probe.offeredAt < 0) return yield* new BenchRefused({ message: 'the interface producer clock moved backwards' });
      if (now < costEnd) {
        completedBeforeCut[kind] += 1;
        addFigure(latency, now - probe.offeredAt);
      } else completedAfterCut[kind] += 1;
    });
    yield* FiberSet.run(
      streams,
      Effect.forever(
        Effect.gen(function* () {
          const job = yield* Queue.take(listJobs);
          const dequeuedAt = causalDetail ? yield* Clock.monotonicTimeNanos : null;
          const observed = yield* sampleList();
          if (job.measured && (yield* Clock.currentTimeMillis) < costEnd) {
            const queueMs = dequeuedAt === null || job.enqueuedAt === undefined ? null : Number(dequeuedAt - job.enqueuedAt) / 1_000_000;
            const offerToEnqueueMs = job.enqueuedWall === undefined ? null : job.enqueuedWall - job.probe.offeredAt;
            if (diagnosticStages !== null) {
              if (queueMs !== null) addFigure(diagnosticStages.listQueueDelay, queueMs);
              if (offerToEnqueueMs !== null && offerToEnqueueMs >= 0) addFigure(diagnosticStages.offerToListEnqueue, offerToEnqueueMs);
              if (observed.initialFrameMs != null) addFigure(diagnosticStages.listInitialFrame, observed.initialFrameMs);
              if (observed.titleRequestMs != null) addFigure(diagnosticStages.listTitleRequest, observed.titleRequestMs);
            }
            if (observed.gap) listEvidence.gap += 1;
            if (observed.reset) listEvidence.reset += 1;
            if (observed.rows === 0) listEvidence.missing += 1;
            if (observed.rows > 1 || observed.more) listEvidence.ambiguous += 1;
            if (observed.rows === 1 && (observed.elapsedMs === null || observed.outcome !== 'success')) listEvidence.noCommit += 1;
            if (observed.elapsedMs !== null && observed.elapsedMs < 0) listEvidence.negative += 1;
            listEvidence.evictedDuringProbe += observed.evicted;
            if (observed.writerPid !== null) listEvidence.writerPids.add(observed.writerPid);
            if (
              !observed.gap &&
              !observed.reset &&
              observed.rows === 1 &&
              !observed.more &&
              observed.outcome === 'success' &&
              observed.elapsedMs !== null &&
              observed.elapsedMs >= 0
            ) {
              addFigure(listLatency, observed.elapsedMs);
              if (
                diagnosticStages !== null &&
                queueMs !== null &&
                offerToEnqueueMs !== null &&
                observed.initialFrameMs != null &&
                observed.titleRequestMs != null &&
                observed.receivedAt != null &&
                observed.writerWaitMs != null &&
                observed.writerHoldMs != null
              ) {
                addFigure(diagnosticStages.listWriterWait, observed.writerWaitMs);
                addFigure(diagnosticStages.listWriterHold, observed.writerHoldMs);
                const example = {
                  id: job.probe.id,
                  offerToEnqueueMs,
                  queueMs,
                  initialMs: observed.initialFrameMs,
                  titleMs: observed.titleRequestMs,
                  waitMs: observed.writerWaitMs,
                  holdMs: observed.writerHoldMs,
                  commitToFrameMs: observed.elapsedMs,
                  receivedFromOfferMs: observed.receivedAt - job.probe.offeredAt,
                };
                diagnosticStages.listExamples.push(example);
                diagnosticStages.listExamples.sort((left, right) => right.receivedFromOfferMs - left.receivedFromOfferMs);
                if (diagnosticStages.listExamples.length > 10) diagnosticStages.listExamples.pop();
              }
            }
          }
          yield* finished('list', job, listOfferedLatency);
        }),
      ),
    );
    yield* FiberSet.run(
      streams,
      Effect.forever(
        Effect.gen(function* () {
          const probe = yield* Queue.take(probes);
          if (probe === 'drain') {
            yield* Deferred.succeed(probeDrained, undefined);
            return;
          }
          if (probe.id === 0) firstProbeAt = probe.scheduledAt;
          if (probe.scheduledAt >= costEnd) return;
          const job: ProbeJob = { probe, measured: probe.scheduledAt >= costStart };
          if (job.measured) {
            probesOffered += 1;
            addFigure(producerDelay, probe.offeredAt - probe.scheduledAt);
          }
          yield* FiberSet.run(
            streams,
            Effect.gen(function* () {
              const answer = yield* world.op('read_block', { blockIds: [root] }, at);
              if (answer.status !== 200 || (answer.body as { status?: string }).status === 'refused')
                return yield* new BenchRefused({ message: `graph open: ${JSON.stringify(answer)}` });
              yield* finished('graph', job, graphLatency);
            }),
          );
          yield* FiberSet.run(
            streams,
            Effect.gen(function* () {
              const subscribedAt = causalDetail ? yield* Clock.currentTimeMillis : null;
              const subscribedMono = causalDetail ? yield* Clock.monotonicTimeNanos : null;
              const first = yield* Stream.runHead(
                feeds.client['thread.subscribe']({
                  projectId,
                  threadId: born[0]?.threadId ?? observer,
                  since: probe.id % 2 === 0 ? undefined : threadCursor,
                }),
              );
              if (Option.isNone(first) || (first.value.type !== 'snapshot' && first.value.type !== 'resume'))
                return yield* new BenchRefused({ message: `thread opened without a usable frame: ${JSON.stringify(first)}` });
              if (threadCursor === undefined || first.value.at.seq > threadCursor.seq) threadCursor = first.value.at;
              if (job.measured) {
                const receivedAt = yield* Clock.currentTimeMillis;
                if (receivedAt < costEnd) {
                  openings[first.value.type] += 1;
                  if (diagnosticStages !== null && subscribedAt !== null && subscribedMono !== null) {
                    if (subscribedAt >= probe.offeredAt) addFigure(diagnosticStages.threadDispatchDelay, subscribedAt - probe.offeredAt);
                    addFigure(
                      diagnosticStages.threadSubscribeToFrame,
                      Number((yield* Clock.monotonicTimeNanos) - subscribedMono) / 1_000_000,
                    );
                    diagnosticStages.threadExamples.push({
                      id: probe.id,
                      offeredAt: probe.offeredAt,
                      subscribedAt,
                      receivedAt,
                      type: first.value.type,
                    });
                    diagnosticStages.threadExamples.sort(
                      (left, right) => right.receivedAt - right.subscribedAt - (left.receivedAt - left.subscribedAt),
                    );
                    if (diagnosticStages.threadExamples.length > 10) diagnosticStages.threadExamples.pop();
                  }
                }
              }
              yield* finished('thread', job, threadLatency);
            }),
          );
          if (causalDetail) {
            const enqueuedAt = yield* Clock.monotonicTimeNanos;
            const enqueuedWall = yield* Clock.currentTimeMillis;
            yield* Queue.offer(listJobs, { ...job, enqueuedAt, enqueuedWall });
          } else yield* Queue.offer(listJobs, job);
        }),
      ),
    );
    const memory: { readonly elapsedMs: number; readonly rss: number; readonly heapUsed: number; readonly external: number }[] = [];
    const backlog: {
      readonly elapsedMs: number;
      readonly emittedFrames: number;
      readonly frameCounts: typeof frameCountsSchema.Type;
      readonly hostedAnnounced: number;
      readonly callsOffered: number;
      readonly submitted: number;
      readonly completed: number;
      readonly turns: number;
      readonly turnsEnded: number;
      readonly stdoutBufferedBytes: number;
      readonly oldestProgressMs: number | null;
    }[] = [];
    let lastProgress: (typeof progressSchema.Type)[] = [];
    const stalls: number[] = [];
    let stallCount = 0;
    const started = yield* Clock.monotonicTimeNanos;
    const profile =
      cpuProfilePath === undefined
        ? null
        : yield* Effect.forkScoped(
            Context.get(world.runtime.measurement, CpuProfiles).capture({
              requestedBy: 'agent-load-bench',
              requestedDurationMs: (warm + seconds + 1) * 1000,
            }),
            { startImmediately: true },
          );
    yield* files.writeFileString(go, 'go');
    yield* Effect.sleep(warm * 1000);
    const warmed = warmSnapshot ? yield* snapshot('warm', false) : null;
    const before = yield* histograms();
    const writerBefore = writerSnapshot(writers);
    const writerUnitsBefore = writers.units({ limit: 1 });
    const requestedBefore = allocatorOf(heapStats())?.malloc_requested;
    const countsBefore = { submitted, completed, failed };
    const framesBefore = feeds.frames();
    const loadBefore = loadavg();
    const unattributedBefore = ledger.read({ limit: 1 }).unattributedStatements;
    const statementsBefore = causalDetail ? world.processes.statements.read({ limit: 2048 }) : null;
    const startWall = yield* Clock.currentTimeMillis;
    costStart = startWall;
    const cpuBefore = process.cpuUsage();
    const threadCpuBefore = process.threadCpuUsage();
    const utilizationBefore = nodePerformance.eventLoopUtilization();
    const intervalStart = yield* Clock.monotonicTimeNanos;
    if (gcMonitored) yield* Effect.sync(() => process.stderr.write('AGENT_LOAD_WINDOW_BEGIN\n'));
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    let churnStarted = false;
    let churnCompletedAt: number | null = null;
    let churnResult: unknown = null;
    if (scenario !== null)
      yield* FiberSet.run(
        streams,
        Effect.gen(function* () {
          yield* Effect.sleep(5000);
          churnStarted = true;
          churnResult = yield* scenario.run();
          churnCompletedAt = yield* Clock.currentTimeMillis;
        }),
      );
    yield* FiberSet.run(
      streams,
      Effect.forever(
        Effect.gen(function* () {
          const previous = yield* Clock.monotonicTimeNanos;
          yield* Effect.sleep(25);
          const delay = Number((yield* Clock.monotonicTimeNanos) - previous) / 1_000_000 - 25;
          if (delay > 100) {
            stallCount += 1;
            if (stalls.length < 20) stalls.push(delay);
            else {
              const smallest = Math.min(...stalls);
              if (delay > smallest) stalls[stalls.indexOf(smallest)] = delay;
            }
          }
        }),
      ),
    );
    yield* FiberSet.run(
      streams,
      Effect.forever(
        Effect.gen(function* () {
          const now = yield* Clock.monotonicTimeNanos;
          const wall = yield* Clock.currentTimeMillis;
          const usage = process.memoryUsage();
          const progress = yield* Effect.forEach(
            born,
            (agent) =>
              Effect.flatMap(
                files.readFileString(join(progressDirectory, `${basename(agent.report)}.json`)),
                Schema.decodeUnknownEffect(progressSchema),
              ),
            { concurrency: 16 },
          );
          lastProgress = progress;
          if (progress.some((entry) => Object.values(entry.frameCounts).reduce((sum, count) => sum + count, 0) !== entry.emittedFrames))
            return yield* new BenchRefused({ message: 'agent frame counts do not add up' });
          const times = progress.map((entry) => Date.parse(entry.recordedAt));
          if (times.some((time) => !Number.isFinite(time)))
            return yield* new BenchRefused({ message: 'agent progress has an invalid timestamp' });
          if (memory.length === 360) memory.shift();
          if (backlog.length === 360) backlog.shift();
          const elapsedMs = Number(now - intervalStart) / 1_000_000;
          memory.push({ elapsedMs, rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external });
          backlog.push({
            elapsedMs,
            emittedFrames: progress.reduce((sum, entry) => sum + entry.emittedFrames, 0),
            frameCounts: progress.reduce(
              (sum, entry) => ({
                text: sum.text + entry.frameCounts.text,
                toolStart: sum.toolStart + entry.frameCounts.toolStart,
                status: sum.status + entry.frameCounts.status,
                boundary: sum.boundary + entry.frameCounts.boundary,
              }),
              { text: 0, toolStart: 0, status: 0, boundary: 0 },
            ),
            hostedAnnounced: progress.reduce((sum, entry) => sum + entry.hostedAnnounced, 0),
            callsOffered: progress.reduce((sum, entry) => sum + entry.callsOffered, 0),
            submitted,
            completed,
            turns: progress.reduce((sum, entry) => sum + entry.turns, 0),
            turnsEnded: progress.reduce((sum, entry) => sum + entry.turnsEnded, 0),
            stdoutBufferedBytes: progress.reduce((sum, entry) => sum + entry.stdoutBufferedBytes, 0),
            oldestProgressMs: times.length === 0 ? null : wall - Math.min(...times),
          });
          yield* Effect.sleep(5000);
        }),
      ),
    );
    yield* Effect.raceFirst(
      Effect.sleep(seconds * 1000),
      Effect.raceFirst(failOnProducer, Effect.raceFirst(feeds.failure, Effect.andThen(FiberSet.join(streams), Effect.never))),
    );
    if (gcMonitored) yield* Effect.sync(() => process.stderr.write('AGENT_LOAD_WINDOW_END\n'));
    loop.disable();
    const intervalEnd = yield* Clock.monotonicTimeNanos;
    const endWall = yield* Clock.currentTimeMillis;
    costEnd = endWall;
    const cpu = process.cpuUsage(cpuBefore);
    const threadCpu = process.threadCpuUsage(threadCpuBefore);
    const utilization = nodePerformance.eventLoopUtilization(utilizationBefore);
    const unattributedAfter = ledger.read({ limit: 1 }).unattributedStatements;
    const statementsAfter = statementsBefore === null ? null : world.processes.statements.read({ limit: 2048 });
    if (
      statementsBefore !== null &&
      statementsAfter !== null &&
      (statementsBefore.rows.length < statementsBefore.total || statementsAfter.rows.length < statementsAfter.total)
    )
      return yield* new BenchRefused({ message: 'the statement fingerprint census exceeded its report limit' });
    const priorStatements = new Map(statementsBefore?.rows.map((row) => [row.fingerprint, row] as const));
    const statementFingerprints =
      statementsAfter === null
        ? null
        : {
            before: statementsBefore?.total,
            after: statementsAfter.total,
            rows: statementsAfter.rows
              .map((row) => {
                const prior = priorStatements.get(row.fingerprint);
                return {
                  fingerprint: row.fingerprint,
                  summary: row.summary,
                  statements: row.statements - (prior?.statements ?? 0),
                  programStatements: row.programStatements - (prior?.programStatements ?? 0),
                  completed: row.completed - (prior?.completed ?? 0),
                  failed: row.failed - (prior?.failed ?? 0),
                  totalMs: row.totalMs - (prior?.totalMs ?? 0),
                  queueMs: row.queueMs - (prior?.queueMs ?? 0),
                  execMs: row.execMs - (prior?.execMs ?? 0),
                };
              })
              .filter((row) => row.statements + row.programStatements + row.completed > 0)
              .sort((left, right) => right.statements + right.programStatements - left.statements - left.programStatements),
          };
    const after = yield* histograms();
    const requestedAfter = allocatorOf(heapStats())?.malloc_requested;
    const writerAfter = writerSnapshot(writers);
    const writerUnitsAfter = writers.units({ limit: 1 });
    const frameTotals = feeds.frames();
    const countsAfter = { submitted, completed, failed, failures: [...failures], deliveredSizes: Object.fromEntries(deliveredSizes) };
    const loopReading = {
      p99Ms: loop.percentile(99) / 1_000_000,
      maxMs: loop.max / 1_000_000,
      stallsOver100Ms: stallCount,
      longestStalls: [...stalls].sort((left, right) => right - left),
    };
    const memoryReading = [...memory];
    const backlogReading = [...backlog];
    const producersReading = [...lastProgress];
    const windowSeconds = Number(intervalEnd - intervalStart) / 1_000_000_000;
    const figures = Object.fromEntries(
      [
        'sql.execute',
        'Store.transaction',
        'Store.permit.wait',
        'Store.execute',
        'Store.commit',
        ...(causalDetail ? ['ThreadFeeds.open', 'ThreadSnapshots.snapshot', 'ThreadSnapshots.attachFrom', 'ThreadSnapshots.reading'] : []),
      ].map((name) => [name, histogramDelta(name, before, after)]),
    );
    endingProbe = true;
    if (probeProcess.exitCode === null && probeProcess.signalCode === null) yield* Effect.sync(() => probeProcess.kill('SIGTERM'));
    yield* Effect.promise(() => probeProcess.exited);
    probeTarget = ByteSize.toBigInt((yield* files.stat(probePath)).size);
    yield* Queue.offer(events, 'interface.events');
    yield* Effect.raceFirst(Deferred.await(probeDrained), Effect.andThen(FiberSet.join(streams), Effect.never));
    yield* Effect.sleep(5000);
    const settledAt = yield* Clock.currentTimeMillis;
    yield* Effect.sync(() => collectCosts(settledAt));
    const captured = profile === null ? null : yield* Fiber.join(profile);
    const artifact =
      captured === null ? null : yield* Schema.decodeUnknownEffect(cpuProfileArtifactSchema)(captured.record.payload.profile);
    if (artifact !== null && cpuProfilePath !== undefined) yield* files.writeFileString(cpuProfilePath, JSON.stringify(artifact));
    const profileWindow = { monotonicStart: Number(intervalStart) / 1_000_000, monotonicEnd: Number(intervalEnd) / 1_000_000 };
    const profileSampling =
      captured === null || artifact === null
        ? null
        : stallSampling(
            artifact,
            { monotonicStart: captured.record.monotonicStart, monotonicEnd: captured.record.monotonicEnd },
            profileWindow,
          );
    const profileCuts =
      captured === null || cpuProfilePath === undefined
        ? []
        : yield* Effect.forEach(captured.cuts, (cut) =>
            Effect.gen(function* () {
              const report = yield* Context.get(world.runtime.measurement, PerformanceReports).read({
                type: 'profile',
                id: cut.id,
                raw: true,
                limit: 1,
              });
              if (report.type !== 'profile' || report.profile.payload.profile === undefined)
                return yield* new BenchRefused({ message: `profile cut ${cut.id} has no raw profile` });
              const cutArtifact = yield* Schema.decodeUnknownEffect(cpuProfileArtifactSchema)(report.profile.payload.profile);
              const file = `${cpuProfilePath}.${cut.id}.cpuprofile`;
              yield* files.writeFileString(file, JSON.stringify(cutArtifact));
              return {
                ...cut,
                file,
                profileStartMs: report.profile.monotonicStart,
                profileEndMs: report.profile.monotonicEnd,
                sampling:
                  stallSampling(
                    cutArtifact,
                    { monotonicStart: report.profile.monotonicStart, monotonicEnd: report.profile.monotonicEnd },
                    profileWindow,
                  ) ?? null,
              };
            }).pipe(Effect.catch((error) => Effect.succeed({ ...cut, file: null, problem: String(error) }))),
          );
    const ledgerReading = {
      ...globalCosts.reading(),
      probe: probeCosts?.reading() ?? null,
      unattributedStatements: {
        before: unattributedBefore,
        after: unattributedAfter,
        duringWindow: unattributedBefore === null || unattributedAfter === null ? null : unattributedAfter - unattributedBefore,
      },
      byAct: aggregatedCosts.read(),
    };
    const firstScheduled = (): number | null => firstProbeAt;
    const initialProbe = firstScheduled();
    const scheduledProbes =
      initialProbe === null
        ? null
        : Math.max(0, Math.floor((endWall - 1 - initialProbe) / 2000) - Math.max(0, Math.ceil((startWall - initialProbe) / 2000)) + 1);
    const boundary = (kind: 'graph' | 'thread' | 'list', held: CostFigure) => {
      const sample = readFigure(held);
      const outstanding = scheduledProbes === null ? null : Math.max(0, scheduledProbes - completedBeforeCut[kind]);
      return {
        scheduled: scheduledProbes,
        offered: probesOffered,
        completedBeforeCut: completedBeforeCut[kind],
        completedAfterCut: completedAfterCut[kind],
        outstandingAtCut: outstanding,
        sampleP50UpperMs: sample.p50Upper,
        sampleP99UpperMs: sample.p99Upper,
        p99UpperMs: outstanding === 0 ? sample.p99Upper : null,
        maxMs: sample.max,
      };
    };
    const churnEnd = (): number | null => churnCompletedAt;
    const churnAt = churnEnd();
    const churnReading = {
      enabled: churn,
      started: churnStarted,
      completedBeforeCut: churnAt !== null && churnAt < endWall,
      completedAt: churnAt,
      result: churnResult,
    };
    const listSample = readFigure(listLatency);
    const listComplete = scheduledProbes !== null && completedBeforeCut.list === scheduledProbes && listSample.count === scheduledProbes;
    const writerReading = {
      ...writerDelta(writerBefore, writerAfter),
      unitRetention: {
        writerId: writerUnitsAfter.writerId,
        reset: writerUnitsBefore.writerId !== writerUnitsAfter.writerId,
        evicted: writerUnitsAfter.evicted - writerUnitsBefore.evicted,
        oldestSequence: writerUnitsAfter.oldestSequence,
        gap: writerUnitsAfter.oldestSequence > writerUnitsBefore.cursor.sequence + 1,
      },
    };
    const completedInWindow = countsAfter.completed - countsBefore.completed;
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const threadCpuMs = (threadCpu.user + threadCpu.system) / 1000;
    const requestedBytes = requestedBefore === undefined || requestedAfter === undefined ? null : requestedAfter - requestedBefore;
    const loaded = yield* snapshot('loaded', !warmSnapshot);
    const historiesAfterCensus =
      turnMin === 0
        ? null
        : yield* Effect.gen(function* () {
            const startedAt = yield* Clock.currentTimeMillis;
            const callsAtStart = completed;
            const rows = yield* Effect.forEach(
              born,
              (agent) =>
                Effect.map(harness.runs.hosting().history(agent.threadId, 'referenced'), (history) => ({
                  threadId: agent.threadId,
                  bytes: Buffer.byteLength(JSON.stringify(history)),
                  messages: history.length,
                })),
              { concurrency: 8 },
            );
            return { startedAt, finishedAt: yield* Clock.currentTimeMillis, callsAtStart, callsAtEnd: completed, rows };
          });
    yield* FiberSet.clear(streams);
    const threadTraces = causalDetail
      ? yield* Effect.gen(function* () {
          yield* Effect.forEach(born, ({ threadId }) => harness.threads.handle(threadId, 'operator').stop(), {
            concurrency: 'unbounded',
            discard: true,
          });
          yield* (yield* PerformanceStore).flush;
          const reports = Context.get(world.runtime.measurement, PerformanceReports);
          const meta = (report: PerformanceReportMeta) => ({
            retainedRange: report.retainedRange,
            inheritedDrops: report.inheritedDrops,
            sessionDrops: report.sessionDrops,
            inheritedDroppedKinds: report.inheritedDroppedKinds,
            sessionDroppedKinds: report.sessionDroppedKinds,
          });
          const candidates: StoredSpanRecord[] = [];
          const slowPages: {
            readonly meta: PerformanceReportMeta;
            readonly total: number | null;
            readonly returned: number;
            readonly next: SlowCursor | null;
          }[] = [];
          let after: SlowCursor | undefined;
          do {
            const slow = yield* reports.read({ type: 'slow', name: 'ThreadFeeds.open', since: startWall, limit: 100, after });
            if (slow.type !== 'slow') return { problem: `slow query answered ${slow.type}`, slowPages, traces: [] };
            slowPages.push({ meta: meta(slow), total: slow.total, returned: slow.spans.length, next: slow.next });
            candidates.push(
              ...slow.spans.filter(
                (span) => span.wallTime <= endWall && span.payload.attributes['thread.id'] === (born[0]?.threadId ?? observer),
              ),
            );
            after = slow.next ?? undefined;
          } while (after !== undefined && candidates.length < 3 && slowPages.length < 10);
          const traces = yield* Effect.forEach(candidates.slice(0, 3), (span) =>
            Effect.gen(function* () {
              const spans: StoredSpanRecord[] = [];
              const pages: { readonly meta: PerformanceReportMeta; readonly totalSpans: number; readonly next: TraceCursor | null }[] = [];
              let after: TraceCursor | undefined;
              do {
                const trace = yield* reports.read({ type: 'trace', traceId: span.traceId, spanId: span.id, limit: 200, after });
                if (trace.type !== 'trace') return { span, pages, problem: `trace query answered ${trace.type}`, spans: [] };
                pages.push({ meta: meta(trace), totalSpans: trace.totalSpans, next: trace.next });
                spans.push(...trace.segments.flatMap((segment) => segment.spans));
                after = trace.next ?? undefined;
              } while (after !== undefined);
              return {
                span,
                pages,
                spans: spans.filter(
                  (item) =>
                    item.name.startsWith('ThreadSnapshots.') ||
                    item.name === 'ThreadFeeds.open' ||
                    item.name === 'Store.transaction' ||
                    item.name === 'Store.permit.wait',
                ),
              };
            }),
          );
          return {
            slowPages,
            selectionCut: after !== undefined,
            matching: 'thread and wall-time interval only; no client probe id',
            traces,
          };
        }).pipe(Effect.catch((error) => Effect.succeed({ problem: String(error), traces: [] })))
      : null;
    console.log(
      JSON.stringify(
        {
          benchmark: 'agent-load',
          configuration: {
            agents,
            activeAgents: born.filter((_agent, index) => index % 5 !== 4).length,
            idleAgents: born.filter((_agent, index) => index % 5 === 4).length,
            auxiliaryAgents: churn ? 1 : 0,
            seconds,
            warm,
            rate,
            subscribers,
            causalDetail,
            probeLedgerCapacity: causalDetail ? probeCapacity : null,
            sqliteHosting: 'child',
            drivers: [...DRIVERS],
            fixtureBytes: resultBytes,
            repositoryFiles,
            projects,
            messageBytes,
            callsPerBoundary,
            historyEntriesPerThread: history,
            parents: parents.length,
            parentSize,
            turnMin,
            turnMax,
            warmSnapshot,
            cpuProfile: cpuProfilePath !== undefined,
          },
          machine: {
            platform: process.platform,
            arch: process.arch,
            cpus: cpus().length,
            totalMemoryBytes: totalmem(),
            loadBefore,
            loadAfter: loadavg(),
            bun: Bun.version,
          },
          durationSeconds: windowSeconds,
          totalStartupSeconds: Number(intervalStart - started) / 1_000_000_000,
          calls: {
            submitted: countsAfter.submitted - countsBefore.submitted,
            completed: countsAfter.completed - countsBefore.completed,
            failed: countsAfter.failed - countsBefore.failed,
            outstandingAtStart: countsBefore.submitted - countsBefore.completed,
            outstandingAtEnd: countsAfter.submitted - countsAfter.completed,
            submittedPerSecond: (countsAfter.submitted - countsBefore.submitted) / windowSeconds,
            completedPerSecond: completedInWindow / windowSeconds,
            nominalWithoutTurnPauses: born.filter((_agent, index) => index % 5 !== 4).length * 0.1 * rate * windowSeconds,
            failures: countsAfter.failures,
            firstDeliveredTextBytesByTool: countsAfter.deliveredSizes,
          },
          metrics: figures,
          ledger: ledgerReading,
          statementFingerprints,
          writer: writerReading,
          churn: churnReading,
          cpuMs,
          cpuMsPerCompletedCall: completedInWindow === 0 ? null : cpuMs / completedInWindow,
          servingThreadCpuMs: threadCpuMs,
          otherThreadsCpuMs: cpuMs - threadCpuMs,
          servingThreadCpuCores: threadCpuMs / (windowSeconds * 1000),
          eventLoopUtilization: utilization.active + utilization.idle === 0 ? null : utilization,
          cpuProfile:
            captured === null
              ? null
              : {
                  file: cpuProfilePath,
                  windowStartMs: Number(intervalStart) / 1_000_000,
                  windowEndMs: Number(intervalEnd) / 1_000_000,
                  profileStartMs: captured.record.monotonicStart,
                  profileEndMs: captured.record.monotonicEnd,
                  cuts: profileCuts,
                  sampling: profileSampling ?? null,
                },
          allocatorRequestedBytes: requestedBytes,
          allocatorRequestedBytesPerCompletedCall:
            completedInWindow === 0 || requestedBytes === null ? null : requestedBytes / completedInWindow,
          loop: loopReading,
          interfaces: {
            producerDelayMs: readFigure(producerDelay),
            retainedThreadOpenTraces: threadTraces,
            graphOfferedToAnswer: boundary('graph', graphLatency),
            threadOfferedToFrame: {
              ...boundary('thread', threadLatency),
              openings,
              ...(diagnosticStages === null
                ? {}
                : {
                    dispatchDelayMs: readFigure(diagnosticStages.threadDispatchDelay),
                    subscribeToFrameMs: readFigure(diagnosticStages.threadSubscribeToFrame),
                    slowExamples: diagnosticStages.threadExamples,
                  }),
            },
            listOfferedToFrame: boundary('list', listOfferedLatency),
            listStages:
              diagnosticStages === null
                ? null
                : {
                    offerToEnqueueMs: readFigure(diagnosticStages.offerToListEnqueue),
                    queueDelayMs: readFigure(diagnosticStages.listQueueDelay),
                    initialFrameMs: readFigure(diagnosticStages.listInitialFrame),
                    titleRequestMs: readFigure(diagnosticStages.listTitleRequest),
                    writerWaitMs: readFigure(diagnosticStages.listWriterWait),
                    writerHoldMs: readFigure(diagnosticStages.listWriterHold),
                    slowExamples: diagnosticStages.listExamples,
                  },
            listCommitToFrame: {
              scheduled: scheduledProbes,
              completedBeforeCut: completedBeforeCut.list,
              observed: listSample.count,
              sampleP50UpperMs: listSample.p50Upper,
              sampleP99UpperMs: listSample.p99Upper,
              p99UpperMs: listComplete ? listSample.p99Upper : null,
              evidence: { ...listEvidence, writerPids: [...listEvidence.writerPids] },
            },
          },
          frames: Object.fromEntries(Object.entries(frameTotals).map(([name, count]) => [name, count - (framesBefore[name] ?? 0)])),
          memory: memoryReading,
          producerProgress: backlogReading,
          producersAtLastSample: producersReading.map((entry, index) => ({ ...entry, idle: index % 5 === 4 })),
          turns: {
            openedThroughCensus: openedTurns,
            settledThroughCensus: settledTurns,
            pendingThroughCensus: born.filter((agent) => agent.pendingTurn !== null).length,
            lifetime: Object.fromEntries(Object.entries(allTurns).map(([name, held]) => [name, readFigure(held)])),
            settledInWindow: Object.fromEntries(Object.entries(measuredTurns).map(([name, held]) => [name, readFigure(held)])),
          },
          census: { before: idle, warmed, loaded, historiesAfterCensus },
          limits: [
            'CPU includes bench driver and probes; span histogram counts are installation-wide',
            'serving-thread CPU excludes other same-process threads; their aggregate includes workers, GC and runtime threads, not child processes',
            'event-loop utilization is unavailable when the runtime reports zero active and idle time',
            'CPU profiling adds sampler overhead and its raw profile can be shorter than the measurement window when a stall cuts it',
            'profile sampled time counts adjacent samples within four periods; it is a busy-work proxy, not event-loop utilization',
            'after the last census the fixture interrupts unfinished calls and turn openings during cleanup; their HTTP 503s are outside the measured window',
            'interface offered-to-answer and offer-to-list-enqueue delays cross the producer and receiver clocks without an established skew bound; list queue delay uses receiver monotonic time',
            'probe stages describe completed samples only; outstanding-at-cut includes delayed or unsubmitted probes',
            'thread-open traces are selectively retained and match a thread and time window, not a unique client probe',
            'list COMMIT-to-frame uses writer and receiver epoch clocks with no established cross-process skew bound; the probe opens an additional transient thread-list subscription',
            'producer progress, including emitted frame kinds, is sampled at cycle boundaries; samples can be stale and omit buffered ACP ingress between the CLI and server',
            'with causal-detail enabled hosted and list probes use a separate bounded causal ledger; protocol steps and selected background roots use the installation ledger; both report evictions and unfinished tails',
            'saved and no-save protocol-step groups partition the reported ProtocolSteps.run roots; a no-save step is not necessarily a text frame',
            'unattributed SQL counts the serving pool during the measurement window, independent of the selected retained roots',
            'statement fingerprint deltas cover the serving pool and can combine producers; the overflow row holds SQL beyond the bounded census',
            'fingerprint Run timings are send-to-reply and child elapsed for acknowledged replies, not CPU; sends and replies can cross the measurement cuts',
            'ledger statements count standalone Run sends; programStatements count statements and guards carried by submitted programs, including those a conflict prevents from running',
            'ledger units count Store transactions; direct activity-database transactions can contribute writer hold without incrementing units, and each activity batch is charged to its first accepted cause',
            'ledger root writer times are sums per act, not per-unit percentiles; late tails have a five-second settling window',
            'writer histograms cover physical outer units; child time is acknowledged statement elapsed, not engine CPU, and incomplete splits are omitted',
            'allocator requested bytes are process-wide and are not total JavaScript allocation',
            'finite turns pause while calls settle and the next hosted turn opens; turn figures count turns settled in the window, while pause can end after it',
            'turn payload figures cover emitted assistant text and hosted input/output text, not the full serialized or resident history',
            'histories are provider-paired logical JSON sampled after the last census; their reads warm HeldHistories and calls may continue during sampling',
            'history is synthetic alternating spoken messages without historical tool calls; extra projects have no code',
            'idle agents hold an open prompt without frames; genuine keep-warm pings are not forced',
            'loadGc.bench.ts reports GC phases only where heap identification permits it; completeness is unverified, and GC logging adds overhead',
          ],
        },
        null,
        2,
      ),
    );
  });
  yield* Effect.provide(runtimeWork, context);
});

BunRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(BunServices.layer)), {
  teardown: (exit) => Runtime.defaultTeardown(exit, (code) => process.exit(code)),
});
