import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { it } from '@runlith/effect-test';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as Scope from 'effect/Scope';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import { localStorePreparationLayer } from './testing/worker.js';
import {
  PerformanceStoreUnavailable,
  recordByteSize,
  type PerformanceRecord,
  type PerformanceStoreOptions,
  type PerformanceSubmission,
} from './store/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { ringRoot, segmentBytesFor } from './SegmentRing.js';
import type { StoredLossRecord, StorePressure } from './protocol/records.js';
import type { TimeCursor } from './protocol/queries.js';

const PENDING_BOUND = 1_500_000;
const ONE_SHED = 16;
const MANY_SHEDS = 40;

it.live('a span burst sheds span buffers and leaves the vitals, the metric snapshot and an acknowledged capture', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-span-burst-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(vitalSubmission('interval-vital', 1, 1_000));
      store.submit(metricSubmission('agent.step', 2, 1_000));
      for (let index = 0; index < ONE_SHED; index += 1) {
        store.submit(largeSpanSubmission(`span-${index}`, 10 + index, 'burst'));
      }
      expect(store.diagnostics().dropCount).toBeGreaterThan(0);

      yield* store.submitDurable(memorySubmission('capture', 100, 1_000));
      yield* store.flush;

      const vitals = yield* reports.read({ type: 'vitals', limit: 10 });
      const names = yield* reports.read({ type: 'names', limit: 10 });
      const captures = yield* reports.read({ type: 'captures', limit: 10 });
      const burst = yield* reports.read({ type: 'trace', traceId: 'burst', limit: 100 });
      if (vitals.type !== 'vitals' || names.type !== 'names' || captures.type !== 'captures') {
        return yield* Effect.die('unexpected report');
      }
      if (burst.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(vitals.vitals.map((record) => record.id)).toEqual(['interval-vital']);
      expect(names.metricNames).toEqual(['agent.step']);
      expect(captures.captures.map((record) => record.id)).toEqual(['capture']);
      expect(vitals.sessionDroppedKinds).toEqual({ span: vitals.sessionDrops });
      expect(burst.totalSpans + vitals.sessionDrops).toBe(ONE_SHED);
    }).pipe(Effect.provide(performanceLayer(options(path, PENDING_BOUND, 40_000_000))));
  }),
);

it.live('each shed window is told once, and the kind counts sum to the persisted drop total', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-shed-windows-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (let index = 0; index < MANY_SHEDS; index += 1) {
        store.submit(largeSpanSubmission(`burst-${index}`, index, 'burst'));
      }
      expect(store.diagnostics().dropCount).toBeGreaterThan(0);

      yield* store.flush;
      const losses = yield* reports.read({ type: 'losses', limit: 10 });
      if (losses.type !== 'losses') return yield* Effect.die('unexpected report');
      const windows = [...losses.losses].sort((a, b) => a.monotonicStart - b.monotonicStart);
      expect(windows.length).toBeGreaterThanOrEqual(2);
      expect(windows.every((record) => record.payload.reason === 'pending-limit')).toBe(true);
      expect(windows.every((record) => record.monotonicEnd >= record.monotonicStart)).toBe(true);
      expect(windows.every((record) => record.instanceId === 'process')).toBe(true);
      expect(windows[0]?.payload.peakPendingBytes ?? 0).toBeGreaterThan(PENDING_BOUND);

      const counted = windows.reduce(
        (total, record) => total + Object.values(record.payload.kinds).reduce((sum, count) => sum + count, 0),
        0,
      );
      expect(counted).toBe(losses.sessionDrops);
      expect(counted).toBe(store.diagnostics().dropCount);
      expect(losses.inheritedDrops).toBe(0);
    }).pipe(Effect.provide(performanceLayer(options(path, PENDING_BOUND, 40_000_000))));
  }),
);

it.live('a summary the bound takes before it is written returns its counts to the open window', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-shed-returned-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (let index = 0; index < MANY_SHEDS; index += 1) {
        store.submit(largeCaptureSubmission(`capture-${index}`, index));
      }
      yield* store.flush;

      const losses = yield* reports.read({ type: 'losses', limit: 50 });
      if (losses.type !== 'losses') return yield* Effect.die('unexpected report');
      const shed = losses.losses.reduce(
        (total, record) => total + Object.values(record.payload.kinds).reduce((sum, count) => sum + count, 0),
        0,
      );
      expect(losses.losses.some((record) => (record.payload.kinds.loss ?? 0) > 0)).toBe(true);
      expect(shed).toBe(losses.sessionDrops);
    }).pipe(Effect.provide(performanceLayer(options(path, PENDING_BOUND, 40_000_000))));
  }),
);

it.live('a failed store keeps the account of the loss no record will carry', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-unrecorded-');
    const path = join(directory, 'performance.sqlite');
    const opened = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(performanceStoreLayer(options(path, 3_000, 10_000_000)), opened);
    const store = Context.get(context, PerformanceStore);
    store.submit(vitalSubmission('shed', 1, 1_000));
    store.submit(largeSpanSubmission('oversized', 2, 'burst'));
    expect(store.diagnostics().dropCount).toBe(1);
    expect(store.diagnostics().unrecorded).toEqual([]);
    yield* Scope.close(opened, Exit.void);

    expect(store.diagnostics().state).toBe('unavailable');
    store.submit(metricSubmission('after.submit', 100, 1_000));
    const refused = yield* Effect.flip(store.submitDurable(memorySubmission('after.durable', 101, 1_000)));
    expect(refused.reason).toBe('store-unavailable');

    const unrecorded = store.diagnostics().unrecorded;
    const byReason = new Map(unrecorded.map((account) => [account.reason, account]));
    expect(byReason.get('pending-limit')?.kinds).toEqual({ span: 1 });
    expect(byReason.get('store-unavailable')?.kinds).toMatchObject({ metric: 1, memory: 1 });
    for (const account of unrecorded) expect(account.to).toBeGreaterThanOrEqual(account.from);
  }),
);

it.live('a losses read answers from process memory when the store cannot reach its file', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-losses-memory-');
    const path = join(directory, 'performance.sqlite');
    const opened = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(performanceLayer(options(path, 3_000, 10_000_000)), opened);
    const store = Context.get(context, PerformanceStore);
    const reports = Context.get(context, PerformanceReports);
    store.submit(vitalSubmission('shed', 1, 1_000));
    store.submit(largeSpanSubmission('oversized', 2, 'burst'));
    expect(store.diagnostics().dropCount).toBe(1);
    yield* Scope.close(opened, Exit.void);

    const losses = yield* reports.read({ type: 'losses', limit: 4 });
    if (losses.type !== 'losses') return yield* Effect.die('expected a losses report');
    expect(losses.evidence).toEqual({
      _tag: 'process-memory',
      reason: 'performance store scope is closed',
    });
    expect(losses.pressure.state).toBe('unavailable');
    expect(losses.sessionDrops).toBeGreaterThan(0);
    expect(losses.losses).toEqual([]);
    const byReason = new Map(losses.unrecorded.map((account) => [account.reason, account]));
    expect(byReason.get('pending-limit')?.kinds).toEqual({ span: 1 });

    const refused = yield* Effect.flip(reports.read({ type: 'names', limit: 4 }));
    expect(refused).toBeInstanceOf(PerformanceStoreUnavailable);
  }),
);

it.live('a buffer crosses at the megabyte ceiling with no flush and no interval', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-flush-ceiling-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      for (let index = 0; index < ONE_SHED; index += 1) {
        store.submit(largeSpanSubmission(`span-${index}`, index, 'burst'));
      }
      yield* waitFor(() => store.pressure().persistedRecords > 0);
      const crossed = store.pressure();
      expect(crossed.persistedRecords).toBeGreaterThanOrEqual(10);
      expect(crossed.pendingRecords).toBe(ONE_SHED - crossed.persistedRecords);

      yield* store.flush;
      expect(store.pressure().persistedRecords).toBe(ONE_SHED);
    }).pipe(
      Effect.provide(
        performanceLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => 40_000_000,
          maxStoredBytes: () => 40_000_000,
          flushIntervalMs: 60_000,
        }),
      ),
    );
  }),
);

it.live('an open buffer crosses on its own interval, with no flush', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-flush-interval-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(vitalSubmission('alone', 1, 1_000));
      yield* waitFor(() => store.pressure().pendingRecords === 0);

      const report = yield* reports.read({ type: 'vitals', limit: 10 });
      if (report.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(report.vitals.map((record) => record.id)).toEqual(['alone']);
    }).pipe(
      Effect.provide(
        performanceLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => 1_000_000,
          maxStoredBytes: () => 10_000_000,
          flushIntervalMs: 1,
        }),
      ),
    );
  }),
);

it.live('consecutive flushes wait for their own idle observation', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-flush-fence-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(vitalSubmission('first', 1, 6));
      yield* store.flush;
      store.submit(vitalSubmission('second', 2, 6));
      yield* store.flush;

      const report = yield* reports.read({ type: 'vitals', limit: 10 });
      if (report.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(report.vitals.map((record) => record.id)).toEqual(['first', 'second']);
    }).pipe(Effect.provide(performanceLayer(options(path, 100, 10_000_000))));
  }),
);

it.live('stable paging survives a restart, and a report names the inherited baseline apart from this process', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-restart-');
    const path = join(directory, 'performance.sqlite');
    const inherited = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        store.submit(vitalSubmission('kept-a', 2, 1_000));
        store.submit(vitalSubmission('kept-b', 3, 1_000));
        for (let index = 0; index < ONE_SHED; index += 1) {
          store.submit(largeSpanSubmission(`earlier-${index}`, 10 + index, 'earlier'));
        }
        yield* store.flush;
        return store.diagnostics().dropCount;
      }),
    ).pipe(Effect.provide(performanceStoreLayer(options(path, PENDING_BOUND, 40_000_000))));
    expect(inherited).toBeGreaterThan(0);

    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const first = yield* reports.read({ type: 'vitals', limit: 10 });
      const second = yield* reports.read({ type: 'vitals', limit: 10 });
      if (first.type !== 'vitals' || second.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(first.vitals.map((record) => record.id)).toEqual(['kept-a', 'kept-b']);
      expect(second.vitals.map((record) => record.id)).toEqual(['kept-a', 'kept-b']);
      expect(first.inheritedDrops).toBe(inherited);
      expect(first.sessionDrops).toBe(0);
      expect(second).toEqual(first);

      for (let index = 0; index < ONE_SHED; index += 1) {
        store.submit(largeSpanSubmission(`own-${index}`, 100 + index, 'own'));
      }
      yield* store.flush;
      const after = yield* reports.read({ type: 'vitals', limit: 10 });
      if (after.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(after.inheritedDrops).toBe(inherited);
      expect(after.sessionDrops).toBe(store.diagnostics().dropCount - inherited);
      expect(after.sessionDrops).toBeGreaterThan(0);
    }).pipe(Effect.provide(performanceLayer(options(path, PENDING_BOUND, 40_000_000))));
  }),
);

it.live('eviction takes a whole segment, so the trace inside it goes with every child', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-evict-trace-');
    const path = join(directory, 'performance.sqlite');
    const maxStoredBytes = 700_000;
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.openGroup('gone');
      store.submit(largeSpanSubmission('gone-parent', 1, 'gone'));
      yield* store.flush;
      const children = yield* fillSegment(maxStoredBytes, path, {
        tag: 'gone-child',
        traceId: 'gone',
        from: 2,
        parentId: 'gone-parent',
      });
      store.submit(vitalSubmission('kept-vital', 500, 6));
      yield* store.flush;
      store.closeGroup('gone');

      yield* traceGone('gone');
      const trace = yield* reports.read({ type: 'trace', traceId: 'gone', limit: 100 });
      const vitals = yield* reports.read({ type: 'vitals', limit: 10 });
      const entries = yield* evictions();
      if (trace.type !== 'trace' || vitals.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(trace.totalSpans).toBe(0);
      expect(trace.segments).toEqual([]);
      expect(vitals.vitals.map((record) => record.id)).toEqual(['kept-vital']);
      expect(kindsIn(entries)).toEqual({ span: children + 1 });
      expect(Math.min(...entries.map((entry) => entry.payload.range?.from ?? 0))).toBe(1);
      expect(Math.max(...entries.map((entry) => entry.payload.range?.to ?? 0))).toBe(children + 1);
    }).pipe(Effect.provide(performanceLayer(maintaining(path, maxStoredBytes))));
  }),
);

it.live('an open retention group holds its segment against the tick until its producer closes', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-active-group-');
    const path = join(directory, 'performance.sqlite');
    const maxStoredBytes = 700_000;
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.openGroup('older');
      const older = yield* fillSegment(maxStoredBytes, path, { tag: 'older', traceId: 'older', from: 1 });
      store.openGroup('held');
      store.openGroup('held');
      expect(store.diagnostics().activeGroups).toBe(2);
      const held = yield* fillSegment(maxStoredBytes, path, { tag: 'held', traceId: 'held', from: 100 });
      store.submit(vitalSubmission('kept-vital', 500, 6));
      yield* store.flush;
      store.closeGroup('older');

      yield* traceGone('older');
      const spared = yield* reports.read({ type: 'trace', traceId: 'held', limit: 100 });
      if (spared.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(spared.totalSpans).toBe(held);
      expect(yield* ringBytes).toBeGreaterThan(maxStoredBytes);
      expect(spansIn(yield* evictions())).toBe(older);

      store.closeGroup('held');
      expect(store.diagnostics().activeGroups).toBe(1);
      store.closeGroup('held');
      expect(store.diagnostics().activeGroups).toBe(0);

      yield* traceGone('held');
      const vitals = yield* reports.read({ type: 'vitals', limit: 10 });
      if (vitals.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(spansIn(yield* evictions())).toBe(older + held);
      expect(vitals.vitals.map((record) => record.id)).toEqual(['kept-vital']);
    }).pipe(Effect.provide(performanceLayer(maintaining(path, maxStoredBytes))));
  }),
);

it.live('a locked performance database cannot stop unrelated work on the observed event loop', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-lock-');
    const path = join(directory, 'performance.sqlite');
    yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        store.submit(vitalSubmission('first', 1, 6));
        yield* store.flush;
        const lock = yield* Effect.acquireRelease(
          Effect.sync(() => new Database(join(ringRoot(path), 'segments', segmentFiles(path).at(-1)!))),
          (lock) =>
            Effect.sync(() => {
              if (lock.inTransaction) lock.exec('ROLLBACK');
              lock.close();
            }),
        );
        lock.exec('BEGIN IMMEDIATE');
        store.submit(vitalSubmission('blocked-write', 2, 6));
        const flushing = yield* Effect.forkChild(store.flush);
        let pulseCompleted = false;
        yield* Effect.forkChild(
          Effect.sleep(1).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                pulseCompleted = true;
              }),
            ),
          ),
        );
        yield* Effect.sleep(10);
        expect(pulseCompleted).toBe(true);
        lock.exec('ROLLBACK');
        yield* Fiber.await(flushing);
      }),
    ).pipe(Effect.provide(performanceStoreLayer(options(path, 100, 10_000_000))));
  }),
);

it.live('a flush answers while the ring still stands over its byte bound', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-flush-retention-');
    const path = join(directory, 'performance.sqlite');
    const maxStoredBytes = 200_000;
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (let index = 0; index < 3; index += 1) {
        store.submit(largeSpanSubmission(`over-${index}`, index + 1, 'over'));
      }
      yield* store.flush;

      const trace = yield* reports.read({ type: 'trace', traceId: 'over', limit: 10 });
      if (trace.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(trace.totalSpans).toBe(3);
      expect(yield* ringBytes).toBeGreaterThan(maxStoredBytes);
      expect(store.diagnostics().dropCount).toBe(0);
    }).pipe(Effect.provide(performanceLayer(options(path, 2_000_000, maxStoredBytes))));
  }),
);

it.live('pressure counts this process, and only its own reading rotates the interval peak', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-pressure-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      for (let index = 0; index < ONE_SHED; index += 1) {
        store.submit(largeCaptureSubmission(`capture-${index}`, index));
      }

      const held = store.diagnostics();
      expect(held.peakPendingBytes).toBeGreaterThan(PENDING_BOUND);
      expect(held.pendingBytes).toBeLessThanOrEqual(PENDING_BOUND);
      expect(held.pendingRecords).toBe(ONE_SHED - held.dropCount + 1);

      const shed = store.pressure();
      expect(shed.droppedRecords).toBe(held.dropCount);
      expect(shed.peakPendingBytes).toBe(held.peakPendingBytes);
      expect(store.diagnostics().peakPendingBytes).toBe(shed.pendingBytes);

      yield* store.flush;
      const settled = store.pressure();
      expect(settled.state).toBe('ready');
      expect(settled.persistedRecords).toBe(held.pendingRecords);
      expect(settled.pendingRecords).toBe(0);
      expect(settled.droppedRecords).toBe(held.dropCount);
      expect(store.pressure().peakPendingBytes).toBe(0);
    }).pipe(Effect.provide(performanceLayer(options(path, PENDING_BOUND, 40_000_000))));
  }),
);

it.live('eviction takes the oldest segment whatever kinds it held, and counts every one of them', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-evict-kinds-');
    const path = join(directory, 'performance.sqlite');
    const maxStoredBytes = 700_000;
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.openGroup('old');
      store.submit(stallSubmission('old-stall', 1, 1_000));
      store.submit(vitalSubmission('old-vital', 1, 1_000));
      yield* store.flush;
      const spans = yield* fillSegment(maxStoredBytes, path, { tag: 'old-span', traceId: 'old', from: 2 });
      store.submit(stallSubmission('new-stall', 500, 1_000));
      store.submit(vitalSubmission('new-vital', 500, 1_000));
      store.submit(largeSpanSubmission('new-span', 500, 'new'));
      yield* store.flush;
      store.closeGroup('old');

      yield* traceGone('old');
      const stalls = yield* reports.read({ type: 'stalls', limit: 10 });
      const vitals = yield* reports.read({ type: 'vitals', limit: 10 });
      const fresh = yield* reports.read({ type: 'trace', traceId: 'new', limit: 10 });
      const entries = yield* evictions();
      if (stalls.type !== 'stalls' || vitals.type !== 'vitals' || fresh.type !== 'trace') {
        return yield* Effect.die('unexpected report');
      }
      expect(fresh.totalSpans).toBe(1);
      expect(stalls.stalls.map((row) => row.stall.id)).toEqual(['new-stall']);
      expect(vitals.vitals.map((record) => record.id)).toEqual(['new-vital']);
      expect(kindsIn(entries)).toEqual({ span: spans, stall: 1, vital: 1 });
      expect(Math.min(...entries.map((entry) => entry.payload.range?.from ?? 0))).toBe(1);
      expect(Math.max(...entries.map((entry) => entry.payload.range?.to ?? 0))).toBe(spans + 1);
      for (const entry of entries) expect(entry.payload.peakPendingBytes).toBeUndefined();
    }).pipe(Effect.provide(performanceLayer(maintaining(path, maxStoredBytes))));
  }),
);

it.live('each evicted segment leaves one dated loss entry that later evictions cannot take', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-loss-entries-');
    const path = join(directory, 'performance.sqlite');
    const maxStoredBytes = 700_000;
    const startedAt = yield* Clock.currentTimeMillis;
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.openGroup('first');
      const first = yield* fillSegment(maxStoredBytes, path, { tag: 'first', traceId: 'first', from: 1 });
      store.submit(vitalSubmission('second-vital', 999, 6));
      yield* store.flush;
      store.openGroup('second');
      const second = yield* fillSegment(maxStoredBytes, path, { tag: 'second', traceId: 'second', from: 1_000 });
      store.submit(vitalSubmission('third-vital', 2_000, 6));
      yield* store.flush;

      const standing = segmentFiles(path).length;
      store.closeGroup('first');
      yield* traceGone('first');
      const early = yield* evictions();
      expect(early.length).toBe(standing - segmentFiles(path).length);
      expect(kindsIn(early)).toEqual({ span: first });
      expect(Math.min(...early.map((entry) => entry.payload.range?.from ?? 0))).toBe(1);
      expect(Math.max(...early.map((entry) => entry.payload.range?.to ?? 0))).toBe(first);
      for (const entry of early) {
        expect(entry.wallTime).toBeGreaterThanOrEqual(startedAt);
        expect(entry.payload.range?.to ?? 0).toBeLessThan(startedAt);
        expect(entry.instanceId).toBe('process');
      }

      store.closeGroup('second');
      yield* traceGone('second');

      const entries = yield* evictions();
      const vitals = yield* reports.read({ type: 'vitals', limit: 10 });
      if (vitals.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(entries.map((entry) => entry.id)).toEqual(expect.arrayContaining(early.map((entry) => entry.id)));
      expect(kindsIn(entries)).toEqual({ span: first + second, vital: 1 });
      expect(Math.max(...entries.map((entry) => entry.payload.range?.to ?? 0))).toBe(1_000 + second - 1);
      expect(vitals.vitals.map((record) => record.id)).toEqual(['third-vital']);
    }).pipe(Effect.provide(performanceLayer(maintaining(path, maxStoredBytes))));

    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (let index = 0; index < 4; index += 1) {
        store.submit(largeSpanSubmission(`shed-${index}`, 3_000 + index, 'shed'));
      }
      expect(store.diagnostics().dropCount).toBeGreaterThan(0);
      yield* store.flush;

      const walked = yield* pageLosses;
      const whole = yield* reports.read({ type: 'losses', limit: 50 });
      if (whole.type !== 'losses') return yield* Effect.die('unexpected report');
      expect(walked.map((entry) => entry.id)).toEqual(whole.losses.map((entry) => entry.id));
      expect(whole.next).toBeNull();
      expect(walked.filter((entry) => entry.payload.reason === 'stored-limit').length).toBeGreaterThan(0);
      expect(walked.filter((entry) => entry.payload.reason === 'pending-limit').length).toBeGreaterThan(0);
      expect(new Set(walked.map((entry) => entry.id)).size).toBe(walked.length);
      expect(walked.map((entry) => entry.wallTime)).toEqual([...walked.map((entry) => entry.wallTime)].sort((a, b) => a - b));
    }).pipe(Effect.provide(performanceLayer(options(path, 300_000, 100_000_000))));
  }),
);

it.live('the stored bound is a high-water mark and eviction cuts to the low-water mark', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-water-marks-');
    const overRoot = yield* scratchDirectory('performance-over-bound-');
    const path = join(directory, 'performance.sqlite');
    const overPath = join(overRoot, 'performance.sqlite');
    const overBound = 500_000;
    const cutBound = 2_500_000;
    const held = yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.openGroup('older');
      yield* fillSegment(overBound, overPath, { tag: 'older', traceId: 'older', from: 1 });
      for (let index = 0; index < 6; index += 1) {
        store.submit(largeSpanSubmission(`open-${index}`, 100 + index, 'open'));
      }
      yield* store.flush;
      store.closeGroup('older');

      yield* traceGone('older');
      const open = yield* reports.read({ type: 'trace', traceId: 'open', limit: 10 });
      if (open.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(open.totalSpans).toBe(6);
      return yield* ringBytes;
    }).pipe(Effect.provide(performanceLayer(maintaining(overPath, overBound))));
    expect(held).toBeGreaterThan(overBound);

    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (const tag of ['first', 'second', 'third'] as const) {
        store.openGroup(tag);
        yield* fillSegment(cutBound, path, { tag, traceId: tag, from: 1 });
      }
      store.submit(vitalSubmission('kept-vital', 500, 6));
      yield* store.flush;
      expect(yield* ringBytes).toBeGreaterThan(cutBound);
      for (const tag of ['first', 'second', 'third'] as const) store.closeGroup(tag);

      const lowWater = cutBound - segmentBytesFor(cutBound);
      yield* waitUntil('the ring cut back to its low-water mark', ringBytes.pipe(Effect.map((bytes) => bytes <= lowWater)));
      const third = yield* reports.read({ type: 'trace', traceId: 'third', limit: 100 });
      if (third.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(third.totalSpans).toBeGreaterThan(0);
      expect((yield* evictions()).length).toBeGreaterThan(0);
    }).pipe(Effect.provide(performanceLayer(maintaining(path, cutBound))));
  }),
);

it.live('what eviction took is inherited whole by the next store over the same ring', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-drop-total-');
    const path = join(directory, 'performance.sqlite');
    const maxStoredBytes = 700_000;
    const taken = yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      store.openGroup('first');
      const first = yield* fillSegment(maxStoredBytes, path, { tag: 'first', traceId: 'first', from: 1 });
      store.openGroup('second');
      const second = yield* fillSegment(maxStoredBytes, path, { tag: 'second', traceId: 'second', from: 1_000 });
      store.submit(vitalSubmission('kept-vital', 2_000, 6));
      yield* store.flush;
      store.closeGroup('first');
      store.closeGroup('second');
      yield* traceGone('first');
      yield* traceGone('second');
      const entries = yield* evictions();
      expect(spansIn(entries)).toBe(first + second);
      expect(store.diagnostics().evictedSegments).toBe(entries.length);
      expect(store.diagnostics().dropCount).toBe(first + second);
      return { taken: first + second, entries: entries.length };
    }).pipe(Effect.provide(performanceLayer(maintaining(path, maxStoredBytes))));
    expect(taken.taken).toBeGreaterThan(1);

    const inherited = yield* Effect.gen(function* () {
      const reports = yield* PerformanceReports;
      const report = yield* reports.read({ type: 'losses', limit: 20 });
      if (report.type !== 'losses') return yield* Effect.die('unexpected report');
      return {
        drops: report.inheritedDrops,
        spans: report.inheritedDroppedKinds?.span ?? 0,
        entries: report.losses.filter((record) => record.payload.reason === 'stored-limit').length,
        session: report.sessionDrops,
      };
    }).pipe(Effect.provide(performanceLayer(options(path, 2_000_000, 100_000_000))));
    expect(inherited.drops).toBe(taken.taken);
    expect(inherited.spans).toBe(taken.taken);
    expect(inherited.entries).toBe(taken.entries);
    expect(inherited.session).toBe(0);
  }),
);

it.live('one vitals page carries a record written without the store section beside one that has it', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-vital-pressure-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(vitalSubmission('before', 1, 6));
      store.submit(sampledVitalSubmission('sampled', 2, 6, store.pressure()));
      yield* store.flush;

      const report = yield* reports.read({ type: 'vitals', limit: 10 });
      if (report.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(report.vitals.map((record) => record.id)).toEqual(['before', 'sampled']);
      expect(report.vitals[0]?.payload.store).toBeUndefined();
      expect(report.vitals[1]?.payload.store?.pendingRecords).toBe(1);
    }).pipe(Effect.provide(performanceLayer(options(path, 1_000_000, 10_000_000))));
  }),
);

const waitFor = Effect.fnUntraced(function* (settled: () => boolean) {
  while (!settled()) yield* Effect.sleep(5);
});

const waitUntil = Effect.fnUntraced(
  function* <E, R>(_state: string, settled: Effect.Effect<boolean, E, R>) {
    while (!(yield* settled)) yield* Effect.sleep(5);
  },
  (waiting, state) =>
    Effect.onInterrupt(waiting, () => Effect.logWarning(`the ring had not reached the state this test waited for: ${state}`)),
);

const segmentFiles = (path: string): ReadonlyArray<string> =>
  readdirSync(join(ringRoot(path), 'segments'))
    .filter((name) => name.endsWith('.sqlite'))
    .sort();

const openSegmentBytes = (path: string): number => {
  const newest = segmentFiles(path).at(-1);
  if (newest === undefined) return 0;
  const file = join(ringRoot(path), 'segments', newest);
  return statSync(file).size + (existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0);
};

const fillSegment = Effect.fnUntraced(function* (
  bound: number,
  path: string,
  span: { readonly tag: string; readonly traceId: string; readonly from: number; readonly parentId?: string },
) {
  const store = yield* PerformanceStore;
  for (let index = 0; index < 40; index += 1) {
    store.submit(largeSpanSubmission(`${span.tag}-${index}`, span.from + index, span.traceId, span.parentId ?? null));
    yield* store.flush;
    if (openSegmentBytes(path) >= segmentBytesFor(bound)) return index + 1;
  }
  return yield* Effect.die('the open segment never reached the size the ring rolls it at');
});

const evictions = Effect.fnUntraced(function* (limit = 20) {
  const reports = yield* PerformanceReports;
  const page = yield* reports.read({ type: 'losses', limit });
  if (page.type !== 'losses') return yield* Effect.die('unexpected report');
  return page.losses.filter((record) => record.payload.reason === 'stored-limit');
});

const traceGone = (traceId: string) =>
  waitUntil(
    `the ${traceId} trace gone from the ring`,
    Effect.gen(function* () {
      const reports = yield* PerformanceReports;
      const trace = yield* reports.read({ type: 'trace', traceId, limit: 1 });
      if (trace.type !== 'trace') return yield* Effect.die('unexpected report');
      return trace.totalSpans === 0;
    }),
  );

const spansIn = (entries: ReadonlyArray<StoredLossRecord>): number =>
  entries.reduce((total, entry) => total + (entry.payload.kinds.span ?? 0), 0);

const kindsIn = (entries: ReadonlyArray<StoredLossRecord>): Record<string, number> => {
  const counted: Record<string, number> = {};
  for (const entry of entries) {
    for (const [kind, count] of Object.entries(entry.payload.kinds)) {
      if (count === undefined) continue;
      counted[kind] = (counted[kind] ?? 0) + count;
    }
  }
  return counted;
};

const pageLosses = Effect.gen(function* () {
  const reports = yield* PerformanceReports;
  const found: StoredLossRecord[] = [];
  let after: TimeCursor | undefined;
  for (let page = 0; page < 50; page += 1) {
    const report = yield* reports.read({ type: 'losses', limit: 1, after });
    if (report.type !== 'losses') return yield* Effect.die('unexpected report');
    found.push(...report.losses);
    if (report.next === null) return found;
    after = report.next;
  }
  return yield* Effect.die('the losses page never ended');
});

const ringBytes = Effect.gen(function* () {
  const reports = yield* PerformanceReports;
  const memory = yield* reports.read({ type: 'memory' });
  if (memory.type !== 'memory') return yield* Effect.die('unexpected report');
  return memory.database.fileBytes;
});

function options(path: string, maxPendingBytes: number, maxStoredBytes: number): PerformanceStoreOptions {
  return { path, instanceId: 'process', maxPendingBytes: () => maxPendingBytes, maxStoredBytes: () => maxStoredBytes };
}

function maintaining(path: string, maxStoredBytes: number): PerformanceStoreOptions {
  return {
    path,
    instanceId: 'process',
    maxPendingBytes: () => 2_000_000,
    maxStoredBytes: () => maxStoredBytes,
    maintainIntervalMs: 20,
  };
}

function performanceLayer(storeOptions: PerformanceStoreOptions) {
  return performanceReportsLayer.pipe(Layer.provideMerge(performanceStoreLayer(storeOptions)), Layer.provide(localStorePreparationLayer));
}

function vitalSubmission(id: string, wallTime: number, byteSize: number, retentionKey = id): PerformanceSubmission {
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
        memory: {
          rssBytes: 1,
          heapTotalBytes: 1,
          heapUsedBytes: 1,
          externalBytes: 0,
          arrayBufferBytes: 0,
        },
        loopDelay: { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 },
      },
    },
    retentionKey,
    byteSize,
  };
}

function sampledVitalSubmission(id: string, wallTime: number, byteSize: number, store: StorePressure): PerformanceSubmission {
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
        memory: {
          rssBytes: 1,
          heapTotalBytes: 1,
          heapUsedBytes: 1,
          externalBytes: 0,
          arrayBufferBytes: 0,
        },
        loopDelay: { count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 },
        store,
      },
    },
    retentionKey: id,
    byteSize,
  };
}

function metricSubmission(name: string, wallTime: number, byteSize: number): PerformanceSubmission {
  return {
    record: {
      id: name,
      kind: 'metric',
      instanceId: 'process',
      wallTime,
      monotonicStart: wallTime,
      monotonicEnd: wallTime + 1,
      name,
      payload: {
        boundariesMs: [1],
        bucketCounts: [0, 0],
        count: 0,
        failures: 0,
        sumMs: 0,
        minMs: 0,
        maxMs: 0,
      },
    },
    retentionKey: name,
    byteSize,
  };
}

function memorySubmission(id: string, wallTime: number, byteSize: number): PerformanceSubmission {
  return {
    record: {
      id,
      kind: 'memory',
      instanceId: 'process',
      wallTime,
      monotonicStart: wallTime,
      monotonicEnd: wallTime + 1,
      payload: { requestedBy: 'test', threads: [] },
    },
    retentionKey: id,
    byteSize,
  };
}

function largeCaptureSubmission(id: string, wallTime: number): PerformanceSubmission {
  const record: PerformanceRecord<'memory'> = {
    id,
    kind: 'memory',
    instanceId: 'process',
    wallTime,
    monotonicStart: wallTime,
    monotonicEnd: wallTime + 1,
    payload: { requestedBy: 'x'.repeat(100_000), threads: [] },
  };
  return { record, retentionKey: id, byteSize: recordByteSize(record) };
}

function stallSubmission(id: string, wallTime: number, byteSize: number, retentionKey = id): PerformanceSubmission {
  return {
    record: {
      id,
      kind: 'stall',
      instanceId: 'process',
      wallTime,
      monotonicStart: wallTime,
      monotonicEnd: wallTime + 1,
      payload: {
        delayMs: 1,
        cpu: { userMicros: 0, systemMicros: 0 },
        memory: {
          rssBytes: 1,
          heapTotalBytes: 1,
          heapUsedBytes: 1,
          externalBytes: 0,
          arrayBufferBytes: 0,
        },
      },
    },
    retentionKey,
    byteSize,
  };
}

function spanSubmission(
  id: string,
  wallTime: number,
  byteSize: number,
  traceId: string,
  parentId: string | null = null,
): PerformanceSubmission {
  return {
    record: {
      id,
      kind: 'span',
      instanceId: 'process',
      wallTime,
      monotonicStart: wallTime,
      monotonicEnd: wallTime + 1,
      traceId,
      parentId,
      name: id,
      payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes: {} },
    },
    retentionKey: traceId,
    byteSize,
  };
}

function largeSpanSubmission(id: string, wallTime: number, traceId: string, parentId: string | null = null): PerformanceSubmission {
  const submission = spanSubmission(id, wallTime, 0, traceId, parentId);
  const record = {
    ...submission.record,
    payload: {
      spanKind: 'internal' as const,
      exit: { _tag: 'Success' as const },
      attributes: { project: 'x'.repeat(100_000) },
    },
  };
  return { record, retentionKey: traceId, byteSize: recordByteSize(record) };
}
