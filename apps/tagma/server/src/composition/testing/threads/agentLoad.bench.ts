import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { gcAndSweep, heapStats } from 'bun:jsc';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { loadavg, totalmem, cpus } from 'node:os';
import { watch } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
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
import { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import { threadSpokenMessageEvent } from '@runlith/agent/thread/events';
import type { FeedPosition } from '@runlith/agent/transcript/live';
import { CostLedger, CurrentCost, rootCost, type CostCause, type CostCursor, type CostRow } from '@runlith/performance/CostLedger';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { SHIPPED_HARNESSES } from '../../../external-harnesses/testing/builtin.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { DRIVERS, type DriverId } from '../../manifest.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import type { ThreadsFeedEvent } from '../../../threads/contract/wire/list.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { makeDoorWorld } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { until } from './protocolRig.js';
import { hostedChild } from './hostedChild.js';
import { loadFeeds } from './loadFeeds.js';
import { loadRetainers } from './loadRetainers.js';

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
const resultBytes = flag('result-bytes', 2048, 1);
const messageBytes = flag('message-bytes', 1024, 1);
const callsPerBoundary = flag('calls-per-boundary', 1, 1);
const history = flag('history', 100, 0);
const repositoryFiles = flag('repository-files', 1, 1);
const projects = flag('projects', 1, 1);
const parentSize = flag('parent-size', 25, 1);
const snapshotDirectory = process.argv.find((value) => value.startsWith('--snapshots='))?.slice('--snapshots='.length);
if (!Number.isSafeInteger(agents)) throw new Error('--agents must be an integer');
if (![resultBytes, messageBytes, history, repositoryFiles, projects, parentSize].every(Number.isSafeInteger))
  throw new Error('payload sizes and fixture counts must be integers');
if (callsPerBoundary !== 1 && callsPerBoundary !== 8) throw new Error('--calls-per-boundary must be 1 or 8');
if (snapshotDirectory !== undefined && !isAbsolute(snapshotDirectory)) throw new Error('--snapshots must be an absolute directory');

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
const progressSchema = Schema.fromJsonString(
  Schema.Struct({
    agent: Schema.String,
    recordedAt: Schema.String,
    emittedFrames: Schema.Number,
    hostedAnnounced: Schema.Number,
    callsOffered: Schema.Number,
    stdoutBufferedBytes: Schema.Number,
  }),
);
type Call = typeof callSchema.Type;
type Probe = typeof probeSchema.Type;
type Agent = { readonly threadId: string; readonly report: string };
const COST_FIELDS = ['statements', 'units', 'programs', 'writerHoldMs', 'writerWaitMs', 'requestBytes', 'responseBytes', 'spans'] as const;
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
type CostGroup = { readonly fields: Record<CostField, CostFigure>; readonly producers: Map<string, number> };
const costs = () => {
  const groups = new Map<string, CostGroup>();
  const add = (row: CostRow) => {
    let group = groups.get(row.name);
    if (group === undefined) {
      const fields = Object.fromEntries(COST_FIELDS.map((field) => [field, figure()])) as Record<CostField, CostFigure>;
      group = { fields, producers: new Map() };
      groups.set(row.name, group);
    }
    for (const field of COST_FIELDS) addFigure(group.fields[field], row.total[field]);
    for (const producer of row.producers)
      group.producers.set(producer.name, (group.producers.get(producer.name) ?? 0) + producer.counts.statements);
  };
  const read = () =>
    Object.fromEntries(
      [...groups].map(([name, group]) => [
        name,
        {
          roots: group.fields.statements.count,
          figures: Object.fromEntries(COST_FIELDS.map((field) => [field, readFigure(group.fields[field])])),
          statementProducers: [...group.producers].sort((left, right) => right[1] - left[1]),
        },
      ]),
    );
  return { add, read };
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
        '--phase',
        String((index * 10000) / agents / rate),
      ];
      if (index % 5 === 4) command.push('--idle');
      yield* files.writeFileString(join(installation, WORLD_COMMAND), `#!/bin/sh\nexec ${command.map(shellQuote).join(' ')}\n`, {
        mode: 0o755,
      });
      const child = yield* hostedChild(world, parents[Math.floor(index / parentSize)]!, 'HOLD the turn');
      const threadId = child.threadId;
      born.push({ threadId, report });
      yield* seedHistory(threadId);
      yield* until(
        Effect.map(files.exists(`${report}.ready`), (ready) => (ready ? true : null)),
        `agent ${index} reached the prompt`,
      );
      const opened = yield* world.op('open_hosted_turn', {}, at, { [GRANT_HEADER]: grantFor(threadId) });
      if (opened.status !== 200 || (opened.body as { status?: string }).status !== 'opened')
        return yield* new BenchRefused({ message: `opening agent ${index}: ${JSON.stringify(opened)}` });
    }
    const followed = born.length === 0 ? [observer] : born.map(({ threadId }) => threadId);
    const feeds = yield* loadFeeds(world.runtime, yield* world.directory('socket'), projectId, followed, subscribers);
    const events = yield* Effect.acquireRelease(Queue.unbounded<string>(), Queue.shutdown);
    const streams = yield* FiberSet.make<void, unknown>();
    const ledger = Context.get(world.runtime.owners, CostLedger);
    const moves = Context.get(world.runtime.graph, MachineStore).moves;
    const committed = moves.committed;
    let titleCommit: { readonly cause: CostCause; at: number | null } | null = null;
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Object.defineProperty(moves, 'committed', {
          configurable: true,
          writable: true,
          value: (tables: ReadonlySet<string> | null) => {
            const fiber = Fiber.getCurrent();
            if (
              titleCommit !== null &&
              fiber !== undefined &&
              Context.get(fiber.context, CurrentCost) === titleCommit.cause &&
              tables?.has('thread')
            )
              titleCommit.at = performance.now();
            committed(tables);
          },
        }),
      ),
      () => Effect.sync(() => Object.defineProperty(moves, 'committed', { configurable: true, writable: true, value: committed })),
    );
    const aggregatedCosts = costs();
    const following = new Map<number, { readonly row: CostRow; readonly before: CostCursor }>();
    const initialPage = ledger.read({ limit: 4096 });
    let cursor: CostCursor = { ledgerId: initialPage.ledgerId, sequence: initialPage.rows.at(-1)?.sequence ?? 0 };
    const evictedBefore = initialPage.evicted;
    let missedRoots = 0;
    let ledgerReset = false;
    let costStart = Number.POSITIVE_INFINITY;
    let costEnd = Number.POSITIVE_INFINITY;
    const collectCosts = (now: number) => {
      const earliest = following.size === 0 ? undefined : Math.min(...following.keys());
      const after = earliest === undefined ? cursor : following.get(earliest)!.before;
      const page = ledger.read({ after, limit: 4096 });
      ledgerReset ||= page.reset;
      const next = page.rows.find((row) => row.sequence > cursor.sequence);
      if (next !== undefined && next.sequence > cursor.sequence + 1) missedRoots += next.sequence - cursor.sequence - 1;
      let before = after;
      for (const row of page.rows) {
        const relevant = row.name.startsWith('bench.hosted.') || row.name.startsWith('ProtocolSteps.');
        if (
          relevant &&
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
    const calls = new Map<string, { readonly agent: Agent; readonly file: FileSystem.File; pending: string }>();
    for (const agent of born)
      calls.set(`${basename(agent.report)}.calls`, { agent, file: yield* files.open(`${agent.report}.calls`, { flag: 'r' }), pending: '' });
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
            Queue.offerUnsafe(events, 'interface.events');
          } else if (String(name) === 'interface.events' || calls.has(String(name))) Queue.offerUnsafe(events, String(name));
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
      const answer = yield* rootCost(
        `bench.hosted.${call.name}`,
        world.op('call_hosted_tool', call, at, { [GRANT_HEADER]: grantFor(agent.threadId) }),
        `${agent.threadId}:${call.toolCallId}`,
      );
      const body = answer.body as {
        readonly status?: string;
        readonly failed?: boolean;
        readonly code?: string;
        readonly content?: readonly { readonly type: string; readonly text?: string }[];
      };
      if (body.status === 'called' && body.failed !== true && !deliveredSizes.has(call.name)) {
        deliveredSizes.set(
          call.name,
          (body.content ?? []).reduce((sum, part) => sum + (part.type === 'text' ? Buffer.byteLength(part.text ?? '') : 0), 0),
        );
      }
      if (answer.status !== 200 || body.status !== 'called' || body.failed === true) {
        failed += 1;
        if (failures.length < 10) failures.push(JSON.stringify({ name: call.name, status: answer.status, body: answer.body }));
      }
      completed += 1;
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
    const snapshot = Effect.fn('agentLoad.snapshot')(function* (label: string) {
      yield* Effect.sync(() => {
        if (gcMonitored && label === 'before') process.stderr.write('AGENT_LOAD_GC_IDENTIFY_BEGIN\n');
        gcAndSweep();
        if (gcMonitored && label === 'before') process.stderr.write('AGENT_LOAD_GC_IDENTIFY_END\n');
      });
      const memory = process.memoryUsage();
      const jsc = jscReading(heapStats());
      if (snapshotDirectory === undefined) return { memory, jsc, retainers: null, file: null };
      yield* files.makeDirectory(snapshotDirectory, { recursive: true });
      const captured = yield* Context.get(world.runtime.measurement, HeapSnapshots).capture({ requestedBy: 'agent-load-bench' });
      const destination = join(snapshotDirectory, `${label}-${agents}.heapsnapshot`);
      yield* files.copy(captured.file, destination);
      const retainers = yield* Effect.tryPromise({
        try: (signal) => loadRetainers(destination, 20, signal),
        catch: (cause) => new BenchRefused({ message: `heap retainer analysis failed: ${String(cause)}` }),
      });
      return { memory, jsc, retainers, file: destination };
    });
    const idle = yield* snapshot('before');
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
    const producerDelay = figure();
    let probesOffered = 0;
    let firstProbeAt: number | null = null;
    const completedBeforeCut = { graph: 0, thread: 0, list: 0 };
    const completedAfterCut = { graph: 0, thread: 0, list: 0 };
    const openings = { snapshot: 0, resume: 0 };
    let threadCursor: FeedPosition | undefined;
    let titleIndex = 0;
    const sampleList = Effect.fn('agentLoad.listBoundary')(function* () {
      const frames = yield* Queue.unbounded<{ readonly frame: ThreadsFeedEvent; readonly received: number }>();
      const listener = yield* Effect.forkScoped(
        Stream.runForEach(feeds.client['threads.subscribe']({ projectId }), (frame) =>
          Queue.offer(frames, { frame, received: performance.now() }).pipe(Effect.asVoid),
        ),
      );
      const receive = Effect.raceFirst(Queue.take(frames), Effect.andThen(Fiber.join(listener), Effect.die('the list subscription ended')));
      yield* receive;
      const title = `load probe ${++titleIndex}`;
      const changed = yield* rootCost(
        'bench.list',
        Effect.gen(function* () {
          const cause = yield* CurrentCost;
          if (cause === null) return yield* new BenchRefused({ message: 'the list probe has no ledger cause' });
          const marker = { cause, at: null as number | null };
          titleCommit = marker;
          const answer = yield* world.op('set_thread_title', { threadId: observer, title }, at);
          return { answer, marker };
        }),
      );
      if (changed.answer.status !== 200 || (changed.answer.body as { status?: string }).status !== 'loaded')
        return yield* new BenchRefused({ message: `list probe title: ${JSON.stringify(changed.answer)}` });
      for (;;) {
        const { frame, received } = yield* receive;
        const matched =
          frame.type === 'row'
            ? frame.row.id === observer && frame.row.title === title
            : frame.type === 'list' && frame.rows.some((row) => row.id === observer && row.title === title);
        if (!matched) continue;
        titleCommit = null;
        if (changed.marker.at === null || received < changed.marker.at)
          return yield* new BenchRefused({ message: 'the list probe did not observe its causing commit before the frame' });
        return received - changed.marker.at;
      }
    }, Effect.scoped);
    const listJobs = yield* Effect.acquireRelease(Queue.unbounded<Probe>(), Queue.shutdown);
    const finished = Effect.fn('agentLoad.probeFinished')(function* (kind: 'graph' | 'thread' | 'list', probe: Probe, latency: CostFigure) {
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
          const probe = yield* Queue.take(listJobs);
          const acknowledged = yield* sampleList();
          if ((yield* Clock.currentTimeMillis) < costEnd) addFigure(listLatency, acknowledged);
          yield* finished('list', probe, listOfferedLatency);
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
          if (probe.scheduledAt < costStart || probe.scheduledAt >= costEnd) return;
          probesOffered += 1;
          addFigure(producerDelay, probe.offeredAt - probe.scheduledAt);
          yield* FiberSet.run(
            streams,
            Effect.gen(function* () {
              const answer = yield* world.op('read_block', { blockIds: [root] }, at);
              if (answer.status !== 200 || (answer.body as { status?: string }).status === 'refused')
                return yield* new BenchRefused({ message: `graph open: ${JSON.stringify(answer)}` });
              yield* finished('graph', probe, graphLatency);
            }),
          );
          yield* FiberSet.run(
            streams,
            Effect.gen(function* () {
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
              if ((yield* Clock.currentTimeMillis) < costEnd) openings[first.value.type] += 1;
              yield* finished('thread', probe, threadLatency);
            }),
          );
          yield* Queue.offer(listJobs, probe);
        }),
      ),
    );
    const memory: { readonly elapsedMs: number; readonly rss: number; readonly heapUsed: number; readonly external: number }[] = [];
    const backlog: {
      readonly elapsedMs: number;
      readonly emittedFrames: number;
      readonly hostedAnnounced: number;
      readonly callsOffered: number;
      readonly submitted: number;
      readonly completed: number;
      readonly stdoutBufferedBytes: number;
      readonly oldestProgressMs: number | null;
    }[] = [];
    const stalls: number[] = [];
    let stallCount = 0;
    const started = yield* Clock.monotonicTimeNanos;
    yield* files.writeFileString(go, 'go');
    yield* Effect.sleep(warm * 1000);
    const before = yield* histograms();
    const requestedBefore = allocatorOf(heapStats())?.malloc_requested;
    const cpuBefore = process.cpuUsage();
    const countsBefore = { submitted, completed, failed };
    const framesBefore = feeds.frames();
    const loadBefore = loadavg();
    const startWall = yield* Clock.currentTimeMillis;
    costStart = startWall;
    const intervalStart = yield* Clock.monotonicTimeNanos;
    if (gcMonitored) yield* Effect.sync(() => process.stderr.write('AGENT_LOAD_WINDOW_BEGIN\n'));
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
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
            hostedAnnounced: progress.reduce((sum, entry) => sum + entry.hostedAnnounced, 0),
            callsOffered: progress.reduce((sum, entry) => sum + entry.callsOffered, 0),
            submitted,
            completed,
            stdoutBufferedBytes: progress.reduce((sum, entry) => sum + entry.stdoutBufferedBytes, 0),
            oldestProgressMs: times.length === 0 ? null : wall - Math.min(...times),
          });
          yield* Effect.sleep(5000);
        }),
      ),
    );
    yield* Effect.raceFirst(
      Effect.sleep(seconds * 1000),
      Effect.raceFirst(feeds.failure, Effect.andThen(FiberSet.join(streams), Effect.never)),
    );
    if (gcMonitored) yield* Effect.sync(() => process.stderr.write('AGENT_LOAD_WINDOW_END\n'));
    loop.disable();
    const intervalEnd = yield* Clock.monotonicTimeNanos;
    const endWall = yield* Clock.currentTimeMillis;
    costEnd = endWall;
    const after = yield* histograms();
    const cpu = process.cpuUsage(cpuBefore);
    const requestedAfter = allocatorOf(heapStats())?.malloc_requested;
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
    const windowSeconds = Number(intervalEnd - intervalStart) / 1_000_000_000;
    const figures = Object.fromEntries(
      ['sql.execute', 'Store.transaction', 'Store.permit.wait', 'Store.execute', 'Store.commit'].map((name) => [
        name,
        histogramDelta(name, before, after),
      ]),
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
    const ledgerReading = {
      evicted: ledger.read({ limit: 1 }).evicted - evictedBefore,
      reset: ledgerReset,
      missedRoots,
      stillFollowing: following.size,
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
    const completedInWindow = countsAfter.completed - countsBefore.completed;
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const requestedBytes = requestedBefore === undefined || requestedAfter === undefined ? null : requestedAfter - requestedBefore;
    const loaded = yield* snapshot('loaded');
    console.log(
      JSON.stringify(
        {
          benchmark: 'agent-load',
          configuration: {
            agents,
            activeAgents: born.filter((_agent, index) => index % 5 !== 4).length,
            idleAgents: born.filter((_agent, index) => index % 5 === 4).length,
            seconds,
            warm,
            rate,
            subscribers,
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
            submittedNotCompleted: countsAfter.submitted - countsAfter.completed,
            failures: countsAfter.failures,
            firstDeliveredTextBytesByTool: countsAfter.deliveredSizes,
          },
          metrics: figures,
          ledger: ledgerReading,
          cpuMs,
          cpuMsPerCompletedCall: completedInWindow === 0 ? null : cpuMs / completedInWindow,
          allocatorRequestedBytes: requestedBytes,
          allocatorRequestedBytesPerCompletedCall:
            completedInWindow === 0 || requestedBytes === null ? null : requestedBytes / completedInWindow,
          loop: loopReading,
          interfaces: {
            producerDelayMs: readFigure(producerDelay),
            graphOfferedToAnswer: boundary('graph', graphLatency),
            threadOfferedToFrame: { ...boundary('thread', threadLatency), openings },
            listOfferedToFrame: boundary('list', listOfferedLatency),
            listPostCommitAcknowledgementToFrame: readFigure(listLatency),
            listCommitToFrame: null,
          },
          frames: Object.fromEntries(Object.entries(frameTotals).map(([name, count]) => [name, count - (framesBefore[name] ?? 0)])),
          memory: memoryReading,
          producerProgress: backlogReading,
          census: { before: idle, loaded },
          limits: [
            'CPU includes bench driver and probes; span histogram counts are installation-wide',
            'interface offered-to-answer includes file delivery from an independent producer; outstanding-at-cut includes delayed or unsubmitted probes',
            'the list post-acknowledgement timestamp is not the commit; the probe opens an additional transient thread-list subscription',
            'producer progress is sampled at cycle boundaries, can be stale, and omits buffered ACP ingress between the CLI and server',
            'ledger root writer times are sums per act, not per-unit percentiles; late tails have a five-second settling window',
            'allocator requested bytes are not total JavaScript allocation',
            'history is synthetic alternating spoken messages without historical tool calls; extra projects have no code',
            'idle agents hold an open prompt without frames; genuine keep-warm pings are not forced',
            'per-unit writer hold and JavaScript allocation are not measured by this report; loadGc.bench.ts reports a sample of GC phases with completeness unverified, and GC logging adds overhead',
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
