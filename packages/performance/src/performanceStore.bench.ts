import { Database } from 'bun:sqlite';
import * as Clock from 'effect/Clock';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { recordByteSize, type PerformanceRecord } from './store/records.js';
import { PerformanceStore, PerformanceStoreReader, performanceStoreLayer } from './store/store.js';
import * as PerformanceTracer from './PerformanceTracer.js';

const tracedProject = Effect.fn('synthetic.catalog.project')(function* (index: number) {
  yield* Effect.annotateCurrentSpan({ opIndex: index, rows: 64, bodyBytes: 512n, payload: 'private synthetic payload' });
  yield* Effect.yieldNow;
  return project(index).length;
});

class BenchmarkFailure extends Data.TaggedError('BenchmarkFailure')<{ readonly message: string }> {}

const measure = process.argv.includes('--measure');
const recovery = process.argv.includes('--recovery');
const config = { operations: measure ? 46_830 : 240, seed: measure ? 4_690 : 938, pairs: 2, producers: 3, reports: measure ? 120 : 12 };
const seedTime = Date.now();
const operation = 'synthetic.catalog.project';
const payload = 'x'.repeat(512);
const input = Array.from({ length: 64 }, (_, index) => ({ id: index, score: (index * 17) % 67, label: `item-${index}` }));
const project = (index: number) => JSON.stringify(input.filter((row) => (row.id + index) % 3 !== 0).sort((a, b) => b.score - a.score));
const EVERY_TRACE = () => 1;
const fail = (message: string) => Effect.fail(new BenchmarkFailure({ message }));
const attempt = <A>(read: () => A) => Effect.try({ try: read, catch: (error) => new BenchmarkFailure({ message: String(error) }) });
const sourceHashes = () =>
  Object.fromEntries(
    [...new Bun.Glob('**/*.ts').scanSync({ cwd: import.meta.dir })].sort().map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(join(import.meta.dir, path)))
        .digest('hex'),
    ]),
  );

function span(index: number, start: number, end: number): PerformanceRecord<'span'> {
  return {
    id: `span-${index}`,
    kind: 'span',
    instanceId: 'benchmark',
    wallTime: Date.now(),
    monotonicStart: start,
    monotonicEnd: end,
    traceId: `trace-${index}`,
    parentId: null,
    name: operation,
    payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: { index, payload } },
  };
}

const RETIRED_OBJECT_PROTOCOL = {
  perRecordMicros: 2.05,
  measured:
    'median of five paired runs on 2026-09-18, 5,000 records x 4 rounds, this machine, alternating with the byte protocol in one process; the same records and the same producer byte sizing, its hand-over being one bun:jsc structured clone per posted batch of up to 469 submissions. The byte protocol measured 1.55 under that pairing. Both arms excluded worker-side work.',
} as const;

const costRecords = measure ? 20_000 : 5_000;

function costRecord(index: number): PerformanceRecord<'span'> {
  return {
    ...span(index, index, index + 1),
    payload: {
      spanKind: 'internal',
      exit: { _tag: 'Success' },
      attributes: { index, payload: `${index}-${'x'.repeat(512)}` },
    },
  };
}

const submissionCost = Effect.fnUntraced(
  function* (path: string) {
    const store = yield* PerformanceStore;
    while (store.diagnostics().state === 'starting') yield* Effect.sleep(1);
    if (store.diagnostics().state !== 'ready') return yield* fail('submission-cost store unavailable');
    const records = Array.from({ length: costRecords }, (_, index) => costRecord(index));

    const submitAll = () => {
      const started = performance.now();
      for (const record of records) {
        store.submit({ record, retentionKey: record.traceId!, byteSize: recordByteSize(record) });
      }
      return performance.now() - started;
    };

    submitAll();
    yield* store.flush;

    const roundsMs: Array<number> = [];
    for (let round = 0; round < 4; round += 1) {
      roundsMs.push(submitAll());
      yield* store.flush;
    }

    const megabyte = 1024 * 1024;
    const transferStarted = performance.now();
    new ArrayBuffer(megabyte).transfer(megabyte);
    const transferMs = performance.now() - transferStarted;

    const perRecordMicros = (roundsMs.reduce((sum, elapsed) => sum + elapsed, 0) * 1_000) / (records.length * roundsMs.length);
    console.log(
      JSON.stringify({
        type: 'submission-cost',
        records: records.length,
        rounds: roundsMs.length,
        perRecordMicros,
        roundsMs,
        handoverMicrosPerFlush: transferMs * 1_000,
        baseline: RETIRED_OBJECT_PROTOCOL,
        costs:
          "Main-thread synchronous cost only, per record: the producer's own byte sizing and everything submit does with the record — encoding it into the open buffer and the queue's bookkeeping. Worker-side decoding, SQLite work and acknowledgement handling are outside it; the store drains between rounds and sheds nothing, so no round pays for another's eviction.",
      }),
    );
  },
  (effect, path) =>
    Effect.provide(
      effect,
      performanceStoreLayer({
        path,
        instanceId: 'benchmark',
        maxPendingBytes: () => 64 * 1024 * 1024,
        maxStoredBytes: () => 1024 * 1024 * 1024,
      }),
    ),
  Effect.timeout('120 seconds'),
);

function storage(path: string) {
  const database = new Database(path, { readonly: true });
  try {
    const pageSize = database.query<{ page_size: number }, []>('pragma page_size').get()!.page_size;
    const pages = database.query<{ page_count: number }, []>('pragma page_count').get()!.page_count;
    const free = database.query<{ freelist_count: number }, []>('pragma freelist_count').get()!.freelist_count;
    const rows = database
      .query<{ records: number; spans: number }, []>("select count(*) as records, sum(kind = 'span') as spans from performance_record")
      .get()!;
    return {
      fileBytes: statSync(path).size,
      walBytes: existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0,
      pageSize,
      pages,
      freePages: free,
      usedBytes: (pages - free) * pageSize,
      ...rows,
    };
  } finally {
    database.close();
  }
}

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: sorted.at(-1) ?? null };
}

const seedFixture = Effect.fnUntraced(
  function* (path: string) {
    const store = yield* PerformanceStore;
    for (let index = 0; index < config.seed; index += 1) {
      const record = { ...span(index, index, index + 1), wallTime: seedTime };
      store.submit({ record, retentionKey: record.traceId!, byteSize: recordByteSize(record) });
    }
    yield* store.flush;
    if (store.diagnostics().state !== 'ready') return yield* fail('seed store unavailable');
    return yield* attempt(() => {
      const database = new Database(path, { readonly: true });
      try {
        return database.serialize();
      } finally {
        database.close();
      }
    });
  },
  (effect, path) =>
    Effect.provide(
      effect,
      performanceStoreLayer({
        path,
        instanceId: 'benchmark',
        maxPendingBytes: () => 64 * 1024 * 1024,
        maxStoredBytes: () => 1024 * 1024 * 1024,
      }),
    ),
  Effect.timeout('60 seconds'),
);

const checkTracer = Effect.fnUntraced(
  function* (path: string) {
    const store = yield* PerformanceStore;
    const reader = yield* PerformanceStoreReader;
    const tracer = yield* PerformanceTracer.make({ instanceId: 'benchmark', recordFloorMicros: 0, keepOneTraceIn: EVERY_TRACE });
    const off = yield* tracedProject(7).pipe(Effect.withTracer(tracer), Effect.withTracerEnabled(false));
    yield* store.flush;
    const disabled = yield* reader.read({ type: 'slow', name: operation, limit: 10 });
    if (disabled._tag !== 'Found' || disabled.report.type !== 'slow' || disabled.report.spans.length !== 0) {
      return yield* fail('disabled tracer produced operation records');
    }
    const on = yield* tracedProject(7).pipe(Effect.withTracer(tracer), Effect.withTracerEnabled(true));
    yield* store.flush;
    const enabled = yield* reader.read({ type: 'slow', name: operation, limit: 10 });
    if (enabled._tag !== 'Found' || enabled.report.type !== 'slow' || enabled.report.spans.length !== 1) {
      return yield* fail('enabled tracer did not retain exactly one operation');
    }
    const record = enabled.report.spans[0]!;
    const expected = { 'operation.index': 7, rows: 64, 'body.bytes': '512' };
    if (
      off !== on ||
      on !== project(7).length ||
      record.payload.exit._tag !== 'Success' ||
      !isDeepStrictEqual(record.payload.attributes, expected)
    ) {
      return yield* fail('traced operation result or serialized attribute projection differs');
    }
    console.log(
      JSON.stringify({
        type: 'tracer-check',
        disabledRecords: disabled.report.spans.length,
        enabledRecords: enabled.report.spans.length,
        result: on,
        attributes: record.payload.attributes,
      }),
    );
  },
  (effect, path) =>
    Effect.provide(
      effect,
      performanceStoreLayer({
        path,
        instanceId: 'benchmark',
        maxPendingBytes: () => 64 * 1024 * 1024,
        maxStoredBytes: () => 1024 * 1024 * 1024,
      }),
    ),
  Effect.timeout('60 seconds'),
);

function arm(path: string, enabled: boolean, scenario: 'near-cap' | 'over-cap', pair: number) {
  let cap = 1024 * 1024 * 1024;
  return Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reader = yield* PerformanceStoreReader;
    while (store.diagnostics().state === 'starting') yield* Effect.sleep(1);
    yield* store.flush;
    if (store.diagnostics().state !== 'ready') return yield* fail('seed store unavailable');
    const tracer = yield* PerformanceTracer.make({ instanceId: 'benchmark', recordFloorMicros: 0, keepOneTraceIn: EVERY_TRACE });
    const seeded = yield* attempt(() => storage(path));
    if (seeded.spans !== config.seed) return yield* fail(`seed retained ${seeded.spans} of ${config.seed}`);
    cap = Math.ceil(seeded.usedBytes * (scenario === 'near-cap' ? 1.1 : 0.6));
    for (let index = 0; index < 32; index += 1) project(index);
    const latencies: number[] = [];
    const reportLatencies: number[] = [];
    const samples: Array<{ elapsedMs: number; rssBytes: number; pressure: ReturnType<typeof store.pressure> }> = [];
    let checksum = 0;
    const startWall = yield* Clock.currentTimeMillis;
    const started = performance.now();
    const cpu = process.cpuUsage();
    const rssStart = process.memoryUsage().rss;
    const baseline = store.pressure();
    const sample = () =>
      samples.push({ elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss, pressure: store.pressure() });
    const measured = yield* Effect.gen(function* () {
      sample();
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          yield* Effect.sleep(5);
          sample();
        }).pipe(Effect.forever),
      );
      store.openGroup('benchmark-maintenance');
      store.closeGroup('benchmark-maintenance');
      yield* Effect.all(
        [
          ...Array.from({ length: config.producers }, (_, lane) =>
            Effect.gen(function* () {
              for (let index = lane; index < config.operations; index += config.producers) {
                const start = performance.now();
                const result = yield* tracedProject(index);
                checksum += result;
                latencies.push(performance.now() - start);
                if (Math.floor(index / config.producers) % 8 === 0) yield* Effect.sleep(1);
              }
            }).pipe(Effect.withTracer(tracer), Effect.withTracerEnabled(enabled)),
          ),
          Effect.gen(function* () {
            for (let index = 0; index < config.reports; index += 1) {
              const start = performance.now();
              const result = yield* reader.read({ type: 'slow', name: operation, since: seedTime, limit: 10 });
              if (result._tag !== 'Found') return yield* fail('slow report missing');
              reportLatencies.push(performance.now() - start);
              yield* Effect.sleep(1);
            }
          }),
        ],
        { concurrency: 4 },
      );
      const workMs = performance.now() - started;
      yield* store.flush;
      sample();
      return { workMs, elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu), rssEnd: process.memoryUsage().rss };
    }).pipe(Effect.scoped);
    const final = store.pressure();
    const diagnostics = store.diagnostics();
    if (diagnostics.state !== 'ready' || final.pendingRecords !== 0) return yield* fail('arm did not drain to ready');
    const losses = yield* reader.read({ type: 'losses', since: startWall, limit: 100 });
    const retained = yield* attempt(() => storage(path));
    if (losses._tag !== 'Found' || losses.report.type !== 'losses') return yield* fail('loss accounting unavailable');
    const spanDrops = losses.report.sessionDroppedKinds.span ?? 0;
    if (retained.spans + spanDrops !== config.seed + (enabled ? config.operations : 0)) {
      return yield* fail('submitted spans are neither retained nor accounted as dropped');
    }
    const expected = Array.from({ length: config.operations }, (_, index) => project(index).length).reduce((sum, value) => sum + value, 0);
    if (checksum !== expected || latencies.length !== config.operations) return yield* fail('operation workload incomplete');
    console.log(
      JSON.stringify({
        type: 'arm',
        pair,
        scenario,
        telemetry: enabled ? 'on' : 'off',
        operation,
        window: { from: startWall, to: startWall + measured.elapsedMs },
        capBytes: cap,
        seeded,
        retained,
        ...measured,
        rssStart,
        sampledPeakRssBytes: Math.max(...samples.map((sample) => sample.rssBytes)),
        operationLatency: distribution(latencies),
        reportLatency: distribution(reportLatencies),
        checksum,
        submitted: enabled ? config.operations : 0,
        persistedDelta: final.persistedRecords - baseline.persistedRecords,
        dropsDelta: final.droppedRecords - baseline.droppedRecords,
        diagnostics,
        losses,
        samples,
      }),
    );
    return checksum;
  }).pipe(
    Effect.provide(
      performanceStoreLayer({ path, instanceId: 'benchmark', maxPendingBytes: () => 64 * 1024 * 1024, maxStoredBytes: () => cap }),
    ),
    Effect.timeout('60 seconds'),
  );
}

const holderSource = `
const { Database } = require('bun:sqlite');
const db = new Database(process.argv[1], { readwrite: true, create: false });
db.exec('PRAGMA busy_timeout = 250; BEGIN IMMEDIATE');
console.log('held');
setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, 10000);
`;

const failureArm = Effect.fnUntraced(
  function* (path: string) {
    const store = yield* PerformanceStore;
    const reader = yield* PerformanceStoreReader;
    const submit = (index: number) => {
      const record = { ...span(index, index, index + 1), wallTime: seedTime };
      store.submit({ record, retentionKey: record.traceId!, byteSize: recordByteSize(record) });
    };
    submit(0);
    yield* store.flush;
    const started = performance.now();
    const holder = yield* Effect.acquireRelease(
      attempt(() => Bun.spawn([process.execPath, '-e', holderSource, path], { cwd: '/tmp', stdout: 'pipe', stderr: 'pipe' })),
      (child) =>
        Effect.gen(function* () {
          child.kill();
          yield* Effect.tryPromise({ try: () => child.exited, catch: (error) => new BenchmarkFailure({ message: String(error) }) }).pipe(
            Effect.catch((error) => Effect.logError(error.message)),
          );
        }),
    );
    const signal = yield* Effect.tryPromise({
      try: () => holder.stdout.getReader().read(),
      catch: (error) => new BenchmarkFailure({ message: String(error) }),
    });
    if (new TextDecoder().decode(signal.value).trim() !== 'held') return yield* fail('fixture writer did not acquire lock');
    submit(1);
    yield* store.flush;
    while (store.diagnostics().state !== 'unavailable') yield* Effect.sleep(5);
    const failed = store.diagnostics();
    const loss = yield* reader.read({ type: 'losses', limit: 10 });
    holder.kill();
    yield* Effect.tryPromise({ try: () => holder.exited, catch: (error) => new BenchmarkFailure({ message: String(error) }) });
    while (store.diagnostics().state !== 'ready') yield* Effect.sleep(5);
    submit(2);
    yield* store.flush;
    const after = store.diagnostics();
    const result = yield* reader.read({ type: 'trace', traceId: 'trace-2', limit: 10 });
    if (
      after.state !== 'ready' ||
      after.restarts < 1 ||
      result._tag !== 'Found' ||
      result.report.type !== 'trace' ||
      result.report.totalSpans !== 1
    ) {
      return yield* fail('replacement did not retain subsequent work');
    }
    console.log(JSON.stringify({ type: 'recovery', elapsedMs: performance.now() - started, failed, after, loss, result }));
  },
  Effect.scoped,
  (effect, path) =>
    Effect.provide(
      effect,
      performanceStoreLayer({
        path,
        instanceId: 'benchmark',
        maxPendingBytes: () => 64 * 1024 * 1024,
        maxStoredBytes: () => 1024 * 1024 * 1024,
        busyTimeoutMs: 250,
      }),
    ),
  Effect.timeout('15 seconds'),
);

await Effect.runPromise(
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      attempt(() => mkdtempSync('/tmp/performance-store-bench-')),
      (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
    );
    const sources = yield* attempt(sourceHashes);
    console.log(
      JSON.stringify({
        type: 'conditions',
        config,
        sources,
        bun: Bun.version,
        pid: process.pid,
        startedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        effectVersion: JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('effect/Effect')), 'utf8')).version,
        scope:
          'Synthetic catalog projection through real PerformanceTracer span creation, metrics, attribute projection, byte sizing and store submission; not Tagma HTTP or browser latency.',
        pairing:
          'Identical withSpan operation in both arms; withTracerEnabled(false/true) changes registration, not sampling. Record floor is zero. Off retains the store, reports and explicit maintenance.',
        costs:
          'Operation latency includes tracer preparation and synchronous submission, not worker persistence completion. Report latency is separate; arm CPU/RSS/work/drain include competing retained reads and maintenance, not pure tracer cost.',
        sampling:
          'CPU user/system are process microseconds including worker threads; RSS sampled every 5 ms plus endpoints, not a kernel peak. Storage bytes/pages are endpoint observations only. Setup and final diagnostic reads excluded.',
        cache:
          'Fresh database and tracer per arm, 32 projection-only warmups; first traced operation includes lazy metric setup. Filesystem and runtime caches uncontrolled; alternating order within two pairs.',
        concurrency:
          '3 producer fibers + 1 report fiber, 1 sampler, 1 store worker; recovery adds 1 isolated lock-holder process; arms serial, fanout <= 6.',
        load: 'Shared machine: other agents and desktop load uncontrolled; smoke establishes harness behavior, not a deployment performance estimate.',
      }),
    );
    yield* submissionCost(join(directory, 'submission-cost.sqlite'));
    yield* checkTracer(join(directory, 'tracer-check.sqlite'));
    const fixture = yield* seedFixture(join(directory, 'seed.sqlite'));
    console.log(
      JSON.stringify({ type: 'fixture', seedTime, bytes: fixture.byteLength, sha256: createHash('sha256').update(fixture).digest('hex') }),
    );
    for (const scenario of ['near-cap', 'over-cap'] as const) {
      for (let pair = 0; pair < config.pairs; pair += 1) {
        const checksums = [];
        for (const enabled of pair % 2 === 0 ? [false, true] : [true, false]) {
          const path = join(directory, `${scenario}-${pair}-${enabled}.sqlite`);
          yield* attempt(() => writeFileSync(path, fixture));
          checksums.push(yield* arm(path, enabled, scenario, pair));
        }
        if (checksums[0] !== checksums[1]) return yield* fail('paired arms performed different operation work');
      }
    }
    if (recovery) yield* failureArm(join(directory, 'recovery.sqlite'));
    const ending = yield* attempt(sourceHashes);
    if (JSON.stringify(sources) !== JSON.stringify(ending))
      return yield* fail('package sources changed during measurement; discard the paired comparison');
    console.log(JSON.stringify({ type: 'complete', sourcesStable: true, endedAt: new Date(yield* Clock.currentTimeMillis).toISOString() }));
  }).pipe(Effect.scoped),
);
