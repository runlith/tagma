import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { it } from '@runlith/effect-test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import {
  PerformanceReportUnavailable,
  recordByteSize,
  type PerformanceRecord,
  type PerformanceStoreOptions,
  type PerformanceSubmission,
} from './store/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { ringRoot } from './SegmentRing.js';

const PENDING_BOUND = 1_500_000;
const BURST = 16;

const HOLDER = `
  const { Database } = require('bun:sqlite');
  const shared = process.argv[2] === 'BEGIN';
  const db = new Database(process.argv[1], { readonly: shared, readwrite: !shared, create: false });
  db.run('PRAGMA busy_timeout = 200;');
  for (const statement of process.argv[2].split('|')) db.run(statement);
  // Any file of the ring can be held this way — a segment or the catalog — so the read that takes
  // the lock asks about the schema rather than about a table only one of them has.
  db.query('select count(*) from sqlite_schema').get();
  console.error('held');
  setInterval(() => {}, 1_000);
`;

const READER = 'BEGIN';
const WRITER = 'BEGIN IMMEDIATE';
const EXCLUSIVE = 'PRAGMA locking_mode = EXCLUSIVE|BEGIN IMMEDIATE';

const holdStore = async (path: string, how = READER) => {
  const holder = Bun.spawn(['bun', '-e', HOLDER, path, how], { stderr: 'pipe' });
  const first = await holder.stderr.getReader().read();
  if (!new TextDecoder().decode(first.value).includes('held')) throw new Error('the holder never took the lock');
  return holder;
};

const segmentsOf = (path: string): ReadonlyArray<string> =>
  readdirSync(join(ringRoot(path), 'segments'))
    .filter((name) => name.endsWith('.sqlite'))
    .sort()
    .map((name) => join(ringRoot(path), 'segments', name));

const openSegment = (path: string): string => {
  const newest = segmentsOf(path).at(-1);
  if (newest === undefined) throw new Error('the ring has no segment file yet');
  return newest;
};

const catalogOf = (path: string): string => join(ringRoot(path), 'catalog.sqlite');

const storedIds = (path: string): ReadonlyArray<string> => {
  const found: string[] = [];
  for (const file of segmentsOf(path)) {
    const database = new Database(file);
    try {
      found.push(
        ...database
          .query<{ id: string }, []>('select id from performance_record order by wall_time')
          .all()
          .map((row) => row.id),
      );
    } finally {
      database.close();
    }
  }
  return found;
};

it.live('a commit that loses the database lock ends its worker and the replacement takes the queue', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-recovery-');
    const path = join(directory, 'performance.sqlite');
    let holder: Bun.Subprocess | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => holder?.kill()));
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      store.submit(vital('before', 1));
      yield* store.flush;
      expect(store.diagnostics().state).toBe('ready');

      holder = yield* Effect.promise(() => holdStore(openSegment(path), WRITER));
      store.submit(vital('during', 2));
      yield* store.flush;
      yield* waitFor(() => store.diagnostics().state === 'unavailable');
      expect(store.diagnostics().lastError).toContain('locked');

      holder.kill();
      yield* Effect.promise(() => holder!.exited);
      yield* waitFor(() => store.diagnostics().state === 'ready');
      expect(store.diagnostics().restarts).toBeGreaterThanOrEqual(1);

      store.submit(vital('after', 3));
      yield* store.flush;
      expect(store.diagnostics().dropCount).toBe(0);
    }).pipe(
      Effect.provide(
        performanceStoreLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => 1_000_000,
          maxStoredBytes: () => 100_000_000,
          busyTimeoutMs: 250,
        } satisfies PerformanceStoreOptions),
      ),
    );

    const ids = storedIds(path);
    expect(ids).toContain('before');
    expect(ids).toContain('after');
  }),
);

it.live('a commit lands while an external reader holds the file, and the store keeps a log rather than a journal', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-journal-');
    const path = join(directory, 'performance.sqlite');
    let holder: Bun.Subprocess | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => holder?.kill()));
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      store.submit(vital('before', 1));
      yield* store.flush;

      const segment = openSegment(path);
      holder = yield* Effect.promise(() => holdStore(segment));
      store.submit(vital('under-a-reader', 2));
      yield* store.flush;
      expect(store.diagnostics().state).toBe('ready');
      expect(store.diagnostics().dropCount).toBe(0);
      expect(store.diagnostics().restarts).toBe(0);
      expect(existsSync(`${segment}-wal`)).toBe(true);
      expect(existsSync(`${segment}-journal`)).toBe(false);
    }).pipe(Effect.provide(performanceStoreLayer(storeOptions(path, () => 100_000_000))));

    expect(storedIds(path)).toContain('under-a-reader');
  }),
);

it.live('a report past its own deadline fails as a report and leaves the worker and the queue standing', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-report-deadline-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(vital('before', 1));
      yield* store.flush;
      expect(store.diagnostics().state).toBe('ready');

      const failure = yield* reports.read({ type: 'overview', since: 1, until: 1_000, limit: 10 }).pipe(Effect.flip);
      expect(failure).toBeInstanceOf(PerformanceReportUnavailable);
      expect(store.diagnostics().state).toBe('ready');
      expect(store.diagnostics().restarts).toBe(0);
      expect(store.diagnostics().uncertainRecords).toBe(0);
      expect(store.diagnostics().dropCount).toBe(0);

      store.submit(vital('after', 2));
      yield* store.flush;
      expect(store.diagnostics().state).toBe('ready');
      expect(store.diagnostics().restarts).toBe(0);
    }).pipe(
      Effect.provide(
        performanceReportsLayer.pipe(
          Layer.provideMerge(
            performanceStoreLayer({
              path,
              instanceId: 'process',
              maxPendingBytes: () => 1_000_000,
              maxStoredBytes: () => 100_000_000,
              reportTimeoutMs: 1,
            } satisfies PerformanceStoreOptions),
          ),
        ),
      ),
    );

    expect(storedIds(path)).toEqual(['before', 'after']);
  }),
);

it.live("a first worker that never opened leaves the file's own drop count to its replacement", () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-inherited-');
    const path = join(directory, 'performance.sqlite');
    let holder: Bun.Subprocess | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => holder?.kill()));
    const shed = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        for (let index = 0; index < BURST; index += 1) store.submit(span(`burst-${index}`, index));
        yield* store.flush;
        return store.diagnostics().dropCount;
      }),
    ).pipe(
      Effect.provide(
        performanceStoreLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => PENDING_BOUND,
          maxStoredBytes: () => 100_000_000,
        } satisfies PerformanceStoreOptions),
      ),
    );
    expect(shed).toBeGreaterThan(0);

    holder = yield* Effect.promise(() => holdStore(catalogOf(path), EXCLUSIVE));
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      yield* waitFor(() => store.diagnostics().state === 'unavailable');
      holder!.kill();
      yield* Effect.promise(() => holder!.exited);
      yield* waitFor(() => store.diagnostics().state === 'ready');
      expect(store.diagnostics().restarts).toBeGreaterThanOrEqual(1);

      const report = yield* reports.read({ type: 'losses', limit: 10 });
      if (report.type !== 'losses') return yield* Effect.die('unexpected report');
      expect(report.inheritedDrops).toBe(shed);
      expect(report.inheritedDroppedKinds?.span).toBe(shed);
      expect(report.sessionDrops).toBe(0);
    }).pipe(Effect.provide(performanceReportsLayer.pipe(Layer.provideMerge(performanceStoreLayer(storeOptions(path, () => 100_000_000))))));
  }),
);

it.live('a segment that seals while another process reads it stays readable and the store keeps its worker', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-seal-held-');
    const path = join(directory, 'performance.sqlite');
    let holder: Bun.Subprocess | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => holder?.kill()));
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      store.submit(vital('before-seal', 1));
      yield* store.flush;
      holder = yield* Effect.promise(() => holdStore(openSegment(path)));
      for (let index = 0; index < 12; index += 1) store.submit(fillerSpan(index));
      yield* store.flush;
      store.submit(vital('after-seal', 2));
      yield* store.flush;
      expect(store.diagnostics().lastError).toBeNull();
      expect(store.diagnostics().restarts).toBe(0);
      expect(segmentsOf(path)).toHaveLength(2);
    }).pipe(
      Effect.provide(
        performanceStoreLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => 64_000_000,
          maxStoredBytes: () => 16_000_000,
          busyTimeoutMs: 100,
        } satisfies PerformanceStoreOptions),
      ),
    );
    holder?.kill();
    yield* Effect.promise(async () => holder?.exited);
    const ids = storedIds(path);
    expect(ids).toContain('before-seal');
    expect(ids).toContain('after-seal');
  }),
);

it.live(
  'a file at the store path that is not a database is reported and left where it stands, and a foreign database has the ring open beside it',
  () =>
    Effect.gen(function* () {
      const directory = yield* scratchDirectory('performance-foreign-');
      const path = join(directory, 'performance.sqlite');
      const foreign = new Database(path);
      foreign.run('create table execution (execution_id text primary key)');
      foreign.run("insert into execution values ('kept')");
      foreign.close();
      const garbage = join(directory, 'garbage.sqlite');
      writeFileSync(garbage, 'not a database at all, and longer than a header would be'.repeat(4));
      yield* Effect.gen(function* () {
        const store = yield* PerformanceStore;
        store.submit(vital('beside-garbage', 1));
        yield* store.flush;
        expect(store.diagnostics().lastError).toContain('file is not a database');
      }).pipe(Effect.provide(performanceStoreLayer(storeOptions(garbage, () => 100_000_000))));
      expect(readFileSync(garbage, 'utf8').startsWith('not a database at all')).toBe(true);
      yield* Effect.gen(function* () {
        const store = yield* PerformanceStore;
        store.submit(vital('beside', 1));
        yield* store.flush;
        expect(store.diagnostics().state).toBe('ready');
        expect(store.diagnostics().restarts).toBe(0);
      }).pipe(Effect.provide(performanceStoreLayer(storeOptions(path, () => 100_000_000))));

      expect(storedIds(path)).toEqual(['beside']);
      const standing = new Database(path, { readonly: true });
      try {
        expect(standing.query<{ execution_id: string }, []>('select execution_id from execution').all()).toEqual([
          { execution_id: 'kept' },
        ]);
      } finally {
        standing.close();
      }
    }),
);

it.live('a buffer in flight leaves the queue with the worker it was handed to', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-inflight-lost-');
    const path = join(directory, 'performance.sqlite');
    let holder: Bun.Subprocess | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => holder?.kill()));
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      yield* waitFor(() => store.diagnostics().state === 'ready');
      store.submit(vital('opened-the-segment', 0));
      yield* store.flush;

      holder = yield* Effect.promise(() => holdStore(openSegment(path), WRITER));
      store.submit(vital('handed-a', 1));
      store.submit(vital('handed-b', 2));
      yield* waitFor(() => store.diagnostics().pendingRecords === 0);

      store.submit(vital('newest', 3));
      yield* waitFor(() => store.diagnostics().state === 'unavailable');
      const gone = store.diagnostics();
      expect(gone.uncertainRecords).toBe(2);
      expect(gone.dropCount).toBe(0);
      expect(gone.pendingRecords).toBe(1);

      holder.kill();
      yield* Effect.promise(() => holder!.exited);
      yield* waitFor(() => store.diagnostics().state === 'ready');
      yield* store.flush;
      expect(store.diagnostics().pendingRecords).toBe(0);
    }).pipe(
      Effect.provide(
        performanceStoreLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => 1_000_000,
          maxStoredBytes: () => 100_000_000,
          busyTimeoutMs: 2_000,
          flushIntervalMs: 5,
        } satisfies PerformanceStoreOptions),
      ),
    );
  }),
);

it.live('a drop whose command was never acknowledged still reaches the file through the next worker', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-unacknowledged-drops-');
    const path = join(directory, 'performance.sqlite');
    let holder: Bun.Subprocess | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => holder?.kill()));
    const shed = yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      yield* waitFor(() => store.diagnostics().state === 'ready');
      store.submit(vital('opened-the-segment', 0));
      yield* store.flush;

      holder = yield* Effect.promise(() => holdStore(openSegment(path), WRITER));
      for (let index = 0; index < BURST; index += 1) store.submit(span(`burst-${index}`, index));
      expect(store.diagnostics().dropCount).toBeGreaterThan(0);

      yield* waitFor(() => store.diagnostics().state === 'unavailable');
      holder.kill();
      yield* Effect.promise(() => holder!.exited);
      yield* waitFor(() => store.diagnostics().state === 'ready');
      yield* store.flush;
      return store.diagnostics().dropCount;
    }).pipe(
      Effect.provide(
        performanceStoreLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => PENDING_BOUND,
          maxStoredBytes: () => 100_000_000,
          busyTimeoutMs: 250,
        } satisfies PerformanceStoreOptions),
      ),
    );
    expect(shed).toBeGreaterThan(0);

    const inherited = yield* Effect.gen(function* () {
      const reports = yield* PerformanceReports;
      const report = yield* reports.read({ type: 'losses', limit: 10 });
      if (report.type !== 'losses') return yield* Effect.die('unexpected report');
      return { drops: report.inheritedDrops, spans: report.inheritedDroppedKinds?.span ?? 0 };
    }).pipe(Effect.provide(performanceReportsLayer.pipe(Layer.provideMerge(performanceStoreLayer(storeOptions(path, () => 100_000_000))))));
    expect(inherited.drops).toBe(shed);
    expect(inherited.spans).toBe(shed);
  }),
);

it.live('a group closed while the worker is gone stops protecting its segment once the replacement arrives', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-outage-close-');
    const path = join(directory, 'performance.sqlite');
    let holder: Bun.Subprocess | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => holder?.kill()));
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      yield* waitFor(() => store.diagnostics().state === 'ready');
      store.submit(vital('seed', 0));
      yield* store.flush;

      store.openGroup('stale');
      holder = yield* Effect.promise(() => holdStore(openSegment(path), WRITER));
      store.submit(vital('probe', 1));
      yield* store.flush;
      yield* waitFor(() => store.diagnostics().state === 'unavailable');

      for (let index = 0; index < 16; index += 1) store.submit(staleSpan(index));
      yield* store.flush;
      store.closeGroup('stale');
      expect(store.diagnostics().activeGroups).toBe(0);

      holder.kill();
      yield* Effect.promise(() => holder!.exited);
      yield* waitFor(() => store.diagnostics().state === 'ready');
      yield* store.flush;
      for (let index = 0; index < 8; index += 1) {
        store.submit(fillerSpan(index));
        yield* store.flush;
      }
      yield* waitFor(() => store.diagnostics().evictedSegments >= 3);
      expect(store.diagnostics().evictedSegments).toBe(3);
    }).pipe(
      Effect.provide(
        performanceStoreLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => 2_000_000,
          maxStoredBytes: () => 700_000,
          busyTimeoutMs: 250,
          maintainIntervalMs: 20,
        } satisfies PerformanceStoreOptions),
      ),
    );

    expect(storedIds(path).some((id) => id.startsWith('stale-'))).toBe(false);
  }),
);

it.live('a group opened while the worker is gone protects the segment its records land in', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-outage-open-');
    const path = join(directory, 'performance.sqlite');
    const maxStoredBytes = 700_000;
    let holder: Bun.Subprocess | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => holder?.kill()));
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      yield* waitFor(() => store.diagnostics().state === 'ready');
      store.submit(vital('seed', 0));
      yield* store.flush;

      holder = yield* Effect.promise(() => holdStore(openSegment(path), WRITER));
      store.submit(vital('probe', 1));
      yield* store.flush;
      yield* waitFor(() => store.diagnostics().state === 'unavailable');

      store.openGroup('held');
      store.openGroup('held');
      expect(store.diagnostics().activeGroups).toBe(1);

      holder.kill();
      yield* Effect.promise(() => holder!.exited);
      yield* waitFor(() => store.diagnostics().state === 'ready');

      for (let index = 0; index < 16; index += 1) store.submit(heldSpan(index));
      yield* store.flush;
      for (let index = 0; index < 8; index += 1) {
        store.submit(fillerSpan(index));
        yield* store.flush;
      }
      yield* waitFor(() => store.diagnostics().evictedSegments >= 1);
      const spared = yield* reports.read({ type: 'trace', traceId: 'held', limit: 100 });
      if (spared.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(spared.totalSpans).toBe(16);
      const memory = yield* reports.read({ type: 'memory' });
      if (memory.type !== 'memory') return yield* Effect.die('unexpected report');
      expect(memory.database.fileBytes).toBeGreaterThan(maxStoredBytes);

      store.closeGroup('held');
      expect(store.diagnostics().activeGroups).toBe(1);
      const maintained = store.diagnostics().maintenancePasses;
      yield* waitFor(() => store.diagnostics().maintenancePasses >= maintained + 2);
      const nested = yield* reports.read({ type: 'trace', traceId: 'held', limit: 100 });
      if (nested.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(nested.totalSpans).toBe(16);

      const evicted = store.diagnostics().evictedSegments;
      store.closeGroup('held');
      expect(store.diagnostics().activeGroups).toBe(0);
      yield* waitFor(() => store.diagnostics().evictedSegments > evicted);
      const gone = yield* reports.read({ type: 'trace', traceId: 'held', limit: 1 });
      if (gone.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(gone.totalSpans).toBe(0);
    }).pipe(
      Effect.provide(
        performanceReportsLayer.pipe(
          Layer.provideMerge(
            performanceStoreLayer({
              path,
              instanceId: 'process',
              maxPendingBytes: () => 2_000_000,
              maxStoredBytes: () => maxStoredBytes,
              busyTimeoutMs: 250,
              maintainIntervalMs: 20,
            } satisfies PerformanceStoreOptions),
          ),
        ),
      ),
    );

    expect(storedIds(path).some((id) => id.startsWith('held-'))).toBe(false);
  }),
);

it.live('a store that never opened answers unknown losses and balances groups across its outage', () =>
  Effect.gen(function* () {
    const path = yield* unreachableStorage('performance-outage-balance-');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      expect(store.diagnostics().state).toBe('starting');
      store.openGroup('first');
      store.openGroup('first');
      store.openGroup('second');
      expect(store.diagnostics().activeGroups).toBe(2);
      yield* waitFor(() => store.diagnostics().state === 'unavailable');
      const report = yield* reports.read({ type: 'losses', limit: 10 });
      if (report.type !== 'losses') return yield* Effect.die('unexpected report');
      expect(report.inheritedDrops).toBeNull();
      expect(report.inheritedDroppedKinds).toBeNull();
      expect(report.sessionDrops).toBe(0);
      expect(report.evidence._tag).toBe('process-memory');
      store.openGroup('during');
      expect(store.diagnostics().activeGroups).toBe(3);
      store.closeGroup('first');
      expect(store.diagnostics().activeGroups).toBe(3);
      store.closeGroup('first');
      expect(store.diagnostics().activeGroups).toBe(2);
      store.closeGroup('never-opened');
      expect(store.diagnostics().activeGroups).toBe(2);
      store.closeGroup('second');
      store.closeGroup('during');
      expect(store.diagnostics().activeGroups).toBe(0);
      store.closeGroup('during');
      expect(store.diagnostics().activeGroups).toBe(0);
      expect(store.diagnostics().state).toBe('unavailable');
    }).pipe(Effect.provide(performanceReportsLayer.pipe(Layer.provideMerge(performanceStoreLayer(storeOptions(path, () => 100_000_000))))));
  }),
);

const unreachableStorage = Effect.fnUntraced(function* (prefix: string) {
  const directory = yield* scratchDirectory(prefix);
  const blocker = join(directory, 'blocker');
  writeFileSync(blocker, 'not a directory');
  return join(blocker, 'performance.sqlite');
});

const waitFor = Effect.fnUntraced(
  function* (settled: () => boolean) {
    while (!settled()) yield* Effect.sleep(5);
  },
  Effect.onInterrupt(() => Effect.logWarning('the store had not reached the state this test waited for')),
);

function storeOptions(path: string, maxStoredBytes: () => number): PerformanceStoreOptions {
  return {
    path,
    instanceId: 'process',
    maxPendingBytes: () => 1_000_000,
    maxStoredBytes,
    busyTimeoutMs: 250,
  };
}

function span(id: string, wallTime: number): PerformanceSubmission {
  const record: PerformanceRecord<'span'> = {
    id,
    kind: 'span',
    instanceId: 'process',
    wallTime,
    monotonicStart: wallTime,
    monotonicEnd: wallTime + 1,
    traceId: id,
    parentId: null,
    name: id,
    payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: { project: 'x'.repeat(100_000) } },
  };
  return { record, retentionKey: id, byteSize: recordByteSize(record) };
}

function fillerSpan(index: number): PerformanceSubmission {
  const record: PerformanceRecord<'span'> = {
    id: `filler-${index}`,
    kind: 'span',
    instanceId: 'process',
    wallTime: 1_000 + index,
    monotonicStart: 1_000 + index,
    monotonicEnd: 1_001 + index,
    traceId: 'filler',
    parentId: null,
    name: `filler-${index}`,
    payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: { project: 'x'.repeat(100_000) } },
  };
  return { record, retentionKey: 'filler', byteSize: recordByteSize(record) };
}

function staleSpan(index: number): PerformanceSubmission {
  const record: PerformanceRecord<'span'> = {
    id: `stale-${index}`,
    kind: 'span',
    instanceId: 'process',
    wallTime: index,
    monotonicStart: index,
    monotonicEnd: index + 1,
    traceId: 'stale',
    parentId: null,
    name: `stale-${index}`,
    payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: { project: 'x'.repeat(100_000) } },
  };
  return { record, retentionKey: 'stale', byteSize: recordByteSize(record) };
}

function heldSpan(index: number): PerformanceSubmission {
  const record: PerformanceRecord<'span'> = {
    id: `held-${index}`,
    kind: 'span',
    instanceId: 'process',
    wallTime: index,
    monotonicStart: index,
    monotonicEnd: index + 1,
    traceId: 'held',
    parentId: null,
    name: `held-${index}`,
    payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: { project: 'x'.repeat(100_000) } },
  };
  return { record, retentionKey: 'held', byteSize: recordByteSize(record) };
}

function vital(id: string, wallTime: number): PerformanceSubmission {
  return {
    record: {
      id,
      kind: 'vital',
      instanceId: 'process',
      wallTime,
      monotonicStart: wallTime,
      monotonicEnd: wallTime + 1,
      payload: {
        cpu: { userMicros: 0, systemMicros: 0 },
        memory: { rssBytes: 1, heapTotalBytes: 1, heapUsedBytes: 1, externalBytes: 0, arrayBufferBytes: 0 },
        loopDelay: { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 },
      },
    },
    retentionKey: id,
    byteSize: 1_000,
  };
}
