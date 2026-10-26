import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import { localStorePreparationLayer } from './testing/worker.js';
import type { MetricSample } from './MetricSnapshots.js';
import { type PerformanceRecord, type PerformanceStoreOptions, type PerformanceSubmission, recordByteSize } from './store/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { performanceQuerySchema } from './protocol/queries.js';
import { overviewSeriesSchema, type OverviewSeries } from './protocol/reports.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';

test('overviewQuerySchema requires an explicit non-empty interval and a page', () => {
  const decode = Schema.decodeUnknownResult(performanceQuerySchema);
  expect(decode({ type: 'overview', since: 0, until: 1, limit: 1 })._tag).toBe('Success');
  expect(decode({ type: 'overview', since: 0, until: 1, limit: 1, after: { name: 'a', boundaryKey: '[1]' } })._tag).toBe('Success');
  for (const invalid of [
    { type: 'overview', since: 1, until: 1, limit: 1 },
    { type: 'overview', since: 2, until: 1, limit: 1 },
    { type: 'overview', since: 0, limit: 1 },
    { type: 'overview', until: 1, limit: 1 },
    { type: 'overview', since: 0, until: 1 },
    { type: 'overview', since: 0, until: 1, limit: 0 },
    { type: 'overview', since: -1, until: 1, limit: 1 },
    { type: 'overview', since: 0, until: 1, limit: 1, after: { name: 'a' } },
    { type: 'overview', since: 0, until: 1, limit: 1, after: { name: '', boundaryKey: '[1]' } },
  ]) {
    expect(decode(invalid)._tag).toBe('Failure');
  }
});

test('overview series carry absent percentiles on zero observations and matching reasons', () => {
  const decode = Schema.decodeUnknownResult(overviewSeriesSchema);
  const zero = {
    name: 'quiet',
    boundaryKey: '[10]',
    boundariesMs: [10],
    bucketCounts: [0, 0],
    count: 0,
    failures: 0,
    sumMs: 0,
    partial: false,
    reasons: [],
  };
  expect(decode(zero)._tag).toBe('Success');
  expect(decode({ ...zero, partial: true })._tag).toBe('Failure');
  expect(decode({ ...zero, reasons: ['missing-baseline'] })._tag).toBe('Failure');
  expect(decode({ ...zero, reasons: ['missing-baseline'], partial: true })._tag).toBe('Success');
  expect(decode({ ...zero, reasons: ['no-such-reason'], partial: true })._tag).toBe('Failure');
});

overviewTest('overview totals each name over the interval with percentiles from the sum', 'performance-overview-totals-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    for (const record of [
      metricRecord('a0', 'p1', 900, 'alpha', [10], [5, 0], 0, 20),
      metricRecord('a1', 'p1', 1100, 'alpha', [10], [8, 0], 1, 40),
      metricRecord('a2', 'p1', 1500, 'alpha', [10], [10, 1], 1, 70),
      metricRecord('b1', 'p1', 1200, 'beta', [5], [2, 0], 0, 6),
      metricRecord('b2', 'p1', 1800, 'beta', [5], [5, 0], 0, 15),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;

    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    expect(page.since).toBe(1000);
    expect(page.until).toBe(2000);
    expect(page.observed).toEqual({ from: 1100, to: 1800 });
    expect(page.samplesRead).toBe(5);
    expect(page.next).toBeNull();
    expect(page.series).toEqual([
      {
        name: 'alpha',
        boundaryKey: '[10]',
        boundariesMs: [10],
        bucketCounts: [5, 1],
        count: 6,
        failures: 1,
        sumMs: 50,
        p50: { upperBoundMs: 10 },
        p99: { aboveMs: 10 },
        partial: true,
        reasons: ['clipped-since', 'clipped-until'],
      },
      {
        name: 'beta',
        boundaryKey: '[5]',
        boundariesMs: [5],
        bucketCounts: [3, 0],
        count: 3,
        failures: 0,
        sumMs: 9,
        p50: { upperBoundMs: 5 },
        p99: { upperBoundMs: 5 },
        partial: true,
        reasons: ['clipped-until', 'missing-baseline'],
      },
    ]);
  }),
);

overviewTest('overview never subtracts across instances and folds runs in stream order', 'performance-overview-instances-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    for (const record of [
      metricRecord('g1', 'p1', 1100, 'gamma', [10], [10, 0], 0, 40),
      metricRecord('g2', 'p2', 1200, 'gamma', [10], [100, 0], 5, 400),
      metricRecord('g3', 'p1', 1500, 'gamma', [10], [13, 1], 2, 70),
      metricRecord('g4', 'p2', 1600, 'gamma', [10], [108, 1], 6, 460),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;

    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    expect(page.samplesRead).toBe(4);
    expect(page.series).toEqual([
      {
        name: 'gamma',
        boundaryKey: '[10]',
        boundariesMs: [10],
        bucketCounts: [11, 2],
        count: 13,
        failures: 3,
        sumMs: 90,
        p50: { upperBoundMs: 10 },
        p99: { aboveMs: 10 },
        partial: true,
        reasons: ['clipped-until', 'missing-baseline'],
      },
    ]);
  }),
);

overviewTest('overview keeps changed boundaries as separate partial series', 'performance-overview-boundary-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    for (const record of [
      metricRecord('d0', 'p1', 900, 'delta', [10], [4, 0], 0, 10),
      metricRecord('d1', 'p1', 1100, 'delta', [10], [7, 0], 1, 25),
      metricRecord('d2', 'p1', 1300, 'delta', [20], [7, 0], 1, 25),
      metricRecord('d3', 'p1', 1500, 'delta', [20], [9, 1], 2, 40),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;

    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    expect(page.series).toEqual([
      {
        name: 'delta',
        boundaryKey: '[10]',
        boundariesMs: [10],
        bucketCounts: [3, 0],
        count: 3,
        failures: 1,
        sumMs: 15,
        p50: { upperBoundMs: 10 },
        p99: { upperBoundMs: 10 },
        partial: true,
        reasons: ['clipped-since'],
      },
      {
        name: 'delta',
        boundaryKey: '[20]',
        boundariesMs: [20],
        bucketCounts: [2, 1],
        count: 3,
        failures: 1,
        sumMs: 15,
        p50: { upperBoundMs: 20 },
        p99: { aboveMs: 20 },
        partial: true,
        reasons: ['boundary-change', 'clipped-until'],
      },
    ]);
  }),
);

overviewTest('overview restarts the chain after a counter reset', 'performance-overview-reset-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    for (const record of [
      metricRecord('e0', 'p1', 900, 'eps', [10], [5, 0], 0, 20),
      metricRecord('e1', 'p1', 1100, 'eps', [10], [3, 0], 0, 12),
      metricRecord('e2', 'p1', 1500, 'eps', [10], [6, 0], 0, 30),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;

    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    expect(page.samplesRead).toBe(3);
    expect(page.series).toEqual([
      {
        name: 'eps',
        boundaryKey: '[10]',
        boundariesMs: [10],
        bucketCounts: [3, 0],
        count: 3,
        failures: 0,
        sumMs: 18,
        p50: { upperBoundMs: 10 },
        p99: { upperBoundMs: 10 },
        partial: true,
        reasons: ['clipped-until', 'reset'],
      },
    ]);
  }),
);

overviewTest('overview takes a sample on since as the interval baseline and excludes endings at until', 'performance-overview-edges-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    for (const record of [
      metricRecord('z0', 'p1', 500, 'zeta', [10], [2, 0], 0, 5),
      metricRecord('z1', 'p1', 1000, 'zeta', [10], [5, 0], 0, 15),
      metricRecord('z2', 'p1', 1999, 'zeta', [10], [7, 0], 0, 25),
      metricRecord('z3', 'p1', 2000, 'zeta', [10], [9, 0], 0, 35),
      metricRecord('z4', 'p1', 2500, 'zeta', [10], [12, 0], 0, 50),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;

    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    expect(page.observed).toEqual({ from: 1000, to: 1999 });
    expect(page.samplesRead).toBe(3);
    expect(page.series).toEqual([
      {
        name: 'zeta',
        boundaryKey: '[10]',
        boundariesMs: [10],
        bucketCounts: [2, 0],
        count: 2,
        failures: 0,
        sumMs: 10,
        p50: { upperBoundMs: 10 },
        p99: { upperBoundMs: 10 },
        partial: true,
        reasons: ['clipped-until'],
      },
    ]);
  }),
);

overviewTest('overview pages by name then boundary with exact per-page work', 'performance-overview-paging-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    for (const record of [
      metricRecord('p0', 'p1', 900, 'n1', [10], [0, 0], 0, 0),
      metricRecord('p1', 'p1', 1100, 'n1', [10], [2, 0], 0, 8),
      metricRecord('q0', 'p1', 900, 'n2', [10], [1, 0], 0, 2),
      metricRecord('q1', 'p1', 1100, 'n2', [10], [3, 0], 0, 9),
      metricRecord('q2', 'p1', 1200, 'n2', [20], [3, 0], 0, 9),
      metricRecord('q3', 'p1', 1300, 'n2', [20], [6, 0], 0, 21),
      metricRecord('r0', 'p1', 900, 'n3', [5], [0, 0], 0, 0),
      metricRecord('r1', 'p1', 1400, 'n3', [5], [4, 0], 0, 12),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;
    const paged = yield* collectOverview(1);
    const whole = yield* collectOverview(10);
    expect(paged.series.map((entry) => [entry.name, entry.boundaryKey, entry.count, entry.reasons])).toEqual([
      ['n1', '[10]', 2, ['clipped-since', 'clipped-until']],
      ['n2', '[10]', 2, ['clipped-since']],
      ['n2', '[20]', 3, ['boundary-change', 'clipped-until']],
      ['n3', '[5]', 4, ['clipped-since', 'clipped-until']],
    ]);
    expect(paged.samples).toEqual([6, 6, 6, 6]);
    expect(paged.series).toEqual(whole.series);
  }),
);

overviewTest('overview answers an empty interval with null observed bounds', 'performance-overview-empty-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    for (const record of [
      metricRecord('o1', 'p1', 100, 'out', [10], [1, 0], 0, 2),
      metricRecord('o2', 'p1', 3000, 'out', [10], [2, 0], 0, 5),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;

    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    expect(page.retainedRange).toEqual({ from: 100, to: 3000 });
    expect(page.series).toEqual([]);
    expect(page.observed).toBeNull();
    expect(page.samplesRead).toBe(0);
    expect(page.next).toBeNull();
  }),
);

overviewTest('overview streams a multi-name interval and reports every decoded sample', 'performance-overview-scale-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    const records: MetricSample[] = [];
    for (const name of ['s1', 's2', 's3', 's4']) {
      records.push(metricRecord(`${name}-base`, 'p1', 900, name, [10], [0, 0], 0, 0));
      for (let index = 0; index < 40; index += 1) {
        records.push(metricRecord(`${name}-${index}`, 'p1', 1000 + index * 10, name, [10], [index + 1, 0], 0, index + 1));
      }
    }
    records.push(metricRecord('big-base', 'p1', 900, 'big', [10], [0, 0], 0, 0));
    for (let index = 0; index < 250; index += 1) {
      records.push(metricRecord(`big-${index}`, 'p1', 1000 + index * 3, 'big', [10], [index + 1, 0], 0, index + 1));
    }
    for (const record of records) store.submit(submission(record));
    yield* store.flush;

    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    expect(page.samplesRead).toBe(410);
    expect(page.observed).toEqual({ from: 1000, to: 1747 });
    expect(page.stoppedAtBudget).toBe(false);
    expect(page.next).toBeNull();
    expect(page.series.map((entry) => [entry.name, entry.count, entry.reasons])).toEqual([
      ['big', 249, ['clipped-until']],
      ['s1', 39, ['clipped-until']],
      ['s2', 39, ['clipped-until']],
      ['s3', 39, ['clipped-until']],
      ['s4', 39, ['clipped-until']],
    ]);
  }),
);

overviewTest('overview discriminates edges, resets and zero-count series across many instances', 'performance-overview-mesh-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    for (const record of [
      metricRecord('m1-base', 'm1', 900, 'mesh', [10], [4, 0], 0, 10),
      metricRecord('m1-1', 'm1', 1100, 'mesh', [10], [7, 0], 1, 25),
      metricRecord('m1-2', 'm1', 1500, 'mesh', [10], [9, 0], 1, 40),
      metricRecord('m2-1', 'm2', 1000, 'mesh', [10], [2, 0], 0, 5),
      metricRecord('m2-2', 'm2', 1600, 'mesh', [10], [6, 0], 0, 20),
      metricRecord('m2-succ', 'm2', 2000, 'mesh', [10], [9, 0], 0, 30),
      metricRecord('m3-base', 'm3', 950, 'mesh', [10], [10, 0], 0, 30),
      metricRecord('m3-1', 'm3', 1200, 'mesh', [10], [8, 0], 0, 20),
      metricRecord('m3-2', 'm3', 1700, 'mesh', [10], [11, 0], 0, 35),
      metricRecord('m4-1', 'm4', 1300, 'mesh', [20], [5, 0], 0, 12),
      metricRecord('m4-2', 'm4', 1800, 'mesh', [20], [8, 0], 0, 24),
      metricRecord('m5-base', 'm5', 800, 'mesh', [20], [1, 0], 0, 2),
      metricRecord('m5-1', 'm5', 1400, 'mesh', [20], [4, 0], 0, 10),
      metricRecord('m6-base', 'm6', 900, 'mesh', [30], [0, 0], 0, 0),
      metricRecord('m6-1', 'm6', 1100, 'mesh', [30], [0, 0], 0, 0),
      metricRecord('m6-2', 'm6', 1900, 'mesh', [30], [0, 0], 0, 0),
      metricRecord('m7-1', 'm7', 1400, 'mesh', [40], [0, 0], 0, 0),
      metricRecord('m8-1', 'm8', 1400, 'mesh', [50], [7, 0], 0, 18),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;
    const paged = yield* collectOverview(2);
    const whole = yield* collectOverview(10);
    expect(paged.samples).toEqual([18, 18, 18]);
    expect(paged.series).toEqual(whole.series);
    expect(whole.series.map((entry) => [entry.boundaryKey, entry.count, entry.partial, entry.reasons])).toEqual([
      ['[10]', 12, true, ['clipped-since', 'clipped-until', 'reset']],
      ['[20]', 6, true, ['clipped-since', 'clipped-until', 'missing-baseline']],
      ['[30]', 0, true, ['clipped-since', 'clipped-until']],
      ['[40]', 0, true, ['clipped-until']],
      ['[50]', 0, true, ['clipped-until', 'missing-baseline']],
    ]);
    const ten = whole.series[0]!;
    expect(ten.bucketCounts).toEqual([12, 0]);
    expect(ten.failures).toBe(1);
    expect(ten.sumMs).toBe(60);
    expect(ten.p50).toEqual({ upperBoundMs: 10 });
    expect(ten.p99).toEqual({ upperBoundMs: 10 });
    const twenty = whole.series[1]!;
    expect(twenty.bucketCounts).toEqual([6, 0]);
    expect(twenty.sumMs).toBe(20);
    for (const zero of whole.series.slice(2)) {
      expect(zero.p50).toBeUndefined();
      expect(zero.p99).toBeUndefined();
    }
  }),
);

overviewTest('overview stops the stream once later names sort past the page', 'performance-overview-cutoff-', () =>
  Effect.gen(function* () {
    const seed = (name: string, instance: string, boundary: number): MetricSample[] => [
      metricRecord(`${name}-${instance}-base`, instance, 900, name, [boundary], [0, 0], 0, 0),
      metricRecord(`${name}-${instance}-1`, instance, 1100, name, [boundary], [2, 0], 0, 8),
      metricRecord(`${name}-${instance}-2`, instance, 1500, name, [boundary], [5, 0], 0, 20),
    ];
    const store = yield* PerformanceStore;
    for (const record of [
      ...seed('a', 'a1', 10),
      ...seed('a', 'a2', 20),
      ...seed('a', 'a3', 30),
      ...seed('b', 'b1', 10),
      ...seed('b', 'b2', 20),
      ...seed('b', 'b3', 30),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;
    const paged = yield* collectOverview(2);
    const whole = yield* collectOverview(10);
    expect(paged.samples).toEqual([9, 18, 9]);
    expect(paged.series.map((entry) => [entry.name, entry.boundaryKey, entry.count])).toEqual([
      ['a', '[10]', 5],
      ['a', '[20]', 5],
      ['a', '[30]', 5],
      ['b', '[10]', 5],
      ['b', '[20]', 5],
      ['b', '[30]', 5],
    ]);
    expect(paged.series).toEqual(whole.series);
  }),
);

overviewTest('overview right edge proves quiet, clips growth, and names breaks', 'performance-overview-right-edge-', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    for (const record of [
      metricRecord('a1', 'p1', 1000, 'edge-a', [10], [3, 0], 0, 9),
      metricRecord('a2', 'p1', 1500, 'edge-a', [10], [5, 0], 0, 15),
      metricRecord('b1', 'p1', 1000, 'edge-b', [10], [3, 0], 0, 9),
      metricRecord('b2', 'p1', 1500, 'edge-b', [10], [5, 0], 0, 15),
      metricRecord('b3', 'p1', 2000, 'edge-b', [10], [5, 0], 0, 15),
      metricRecord('c1', 'p1', 1000, 'edge-c', [10], [3, 0], 0, 9),
      metricRecord('c2', 'p1', 1500, 'edge-c', [10], [5, 0], 0, 15),
      metricRecord('c3', 'p1', 2000, 'edge-c', [10], [8, 0], 0, 25),
      metricRecord('d1', 'p1', 1000, 'edge-d', [10], [3, 0], 0, 9),
      metricRecord('d2', 'p1', 1500, 'edge-d', [10], [5, 0], 0, 15),
      metricRecord('d3', 'p1', 2000, 'edge-d', [10], [2, 0], 0, 6),
      metricRecord('e1', 'p1', 1000, 'edge-e', [10], [3, 0], 0, 9),
      metricRecord('e2', 'p1', 1500, 'edge-e', [10], [5, 0], 0, 15),
      metricRecord('e3', 'p1', 2000, 'edge-e', [20], [5, 0], 0, 15),
      metricRecord('f1', 'p1', 1000, 'edge-f', [10], [3, 0], 0, 9),
      metricRecord('f2', 'p1', 1500, 'edge-f', [10], [5, 0], 0, 15),
      metricRecord('f3', 'p1', 2000, 'edge-f', [10], [5, 0], 0, 21),
    ]) {
      store.submit(submission(record));
    }
    yield* store.flush;

    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    expect(page.samplesRead).toBe(17);
    expect(page.observed).toEqual({ from: 1000, to: 1500 });
    expect(page.next).toBeNull();
    expect(page.series.map((entry) => [entry.name, entry.count, entry.partial, entry.reasons])).toEqual([
      ['edge-a', 2, true, ['clipped-until']],
      ['edge-b', 2, false, []],
      ['edge-c', 2, true, ['clipped-until']],
      ['edge-d', 2, true, ['clipped-until', 'reset']],
      ['edge-e', 2, true, ['boundary-change', 'clipped-until']],
      ['edge-f', 2, true, ['clipped-until']],
    ]);
    const clean = page.series[1]!;
    expect(clean.p50).toEqual({ upperBoundMs: 10 });
    expect(clean.p99).toEqual({ upperBoundMs: 10 });
    expect(page.series.map((entry) => entry.boundaryKey)).toEqual(['[10]', '[10]', '[10]', '[10]', '[10]', '[10]']);
  }),
);

it.live('overview stops at its sample budget, keeps only whole names and says it stopped', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-overview-budget-');
    const path = join(directory, 'performance.sqlite');
    const seed = Effect.fnUntraced(function* () {
      const store = yield* PerformanceStore;
      for (const name of ['n1', 'n2', 'n3']) {
        for (let index = 0; index < 10; index += 1) {
          store.submit(submission(metricRecord(`${name}-${index}`, 'p1', 1000 + index * 10, name, [10], [index + 1, 0], 0, index + 1)));
        }
      }
      yield* store.flush;
    });
    const overview = Effect.fnUntraced(function* () {
      const reports = yield* PerformanceReports;
      const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit: 10 });
      if (page.type !== 'overview') return yield* Effect.die('unexpected report');
      return page;
    });
    const whole = yield* Effect.gen(function* () {
      yield* seed();
      return yield* overview();
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
    expect(whole.samplesRead).toBe(30);
    expect(whole.stoppedAtBudget).toBe(false);
    expect(whole.next).toBeNull();
    expect(whole.series.map((entry) => [entry.name, entry.count, entry.reasons])).toEqual([
      ['n1', 9, ['clipped-until']],
      ['n2', 9, ['clipped-until']],
      ['n3', 9, ['clipped-until']],
    ]);

    const partial = yield* overview().pipe(Effect.provide(performanceLayer(storeOptions(path, 15))));
    expect(partial.samplesRead).toBe(15);
    expect(partial.stoppedAtBudget).toBe(true);
    expect(partial.next).toEqual({ name: 'n1', boundaryKey: '[10]' });
    expect(partial.series).toEqual([whole.series[0]!]);

    const none = yield* overview().pipe(Effect.provide(performanceLayer(storeOptions(path, 5))));
    expect(none.samplesRead).toBe(5);
    expect(none.stoppedAtBudget).toBe(true);
    expect(none.series).toEqual([]);
    expect(none.next).toBeNull();
    expect(none.observed).toEqual({ from: 1000, to: 1040 });
  }),
);

const collectOverview = Effect.fnUntraced(function* (limit: number) {
  const reports = yield* PerformanceReports;
  const series: OverviewSeries[] = [];
  const samples: number[] = [];
  let after: { name: string; boundaryKey: string } | undefined;
  do {
    const page = yield* reports.read({ type: 'overview', since: 1000, until: 2000, limit, after });
    if (page.type !== 'overview') return yield* Effect.die('unexpected report');
    series.push(...page.series);
    samples.push(page.samplesRead);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return { series, samples };
});

function overviewTest(name: string, prefix: string, body: () => Effect.Effect<void, unknown, PerformanceStore | PerformanceReports>) {
  it.live(name, () =>
    Effect.gen(function* () {
      const directory = yield* scratchDirectory(prefix);
      const path = join(directory, 'performance.sqlite');
      yield* body().pipe(Effect.provide(performanceLayer(storeOptions(path))));
    }),
  );
}

function performanceLayer(options: PerformanceStoreOptions) {
  return performanceReportsLayer.pipe(Layer.provideMerge(performanceStoreLayer(options)), Layer.provide(localStorePreparationLayer));
}

function storeOptions(path: string, maxReportSamples?: number): PerformanceStoreOptions {
  return {
    path,
    instanceId: 'process',
    maxPendingBytes: () => 1_000_000,
    maxStoredBytes: () => 1_000_000,
    maxReportSamples,
  };
}

function submission(record: PerformanceRecord, retentionKey = record.id): PerformanceSubmission {
  return { record, retentionKey, byteSize: recordByteSize(record) };
}

function metricRecord(
  id: string,
  instanceId: string,
  wallTime: number,
  name: string,
  boundariesMs: ReadonlyArray<number>,
  bucketCounts: ReadonlyArray<number>,
  failures: number,
  sumMs: number,
): MetricSample {
  const count = bucketCounts.reduce((total, bucket) => total + bucket, 0);
  return {
    id,
    kind: 'metric',
    instanceId,
    wallTime,
    monotonicStart: wallTime,
    monotonicEnd: wallTime,
    name,
    payload: {
      boundariesMs,
      bucketCounts,
      count,
      failures,
      sumMs,
      minMs: count === 0 ? 0 : 1,
      maxMs: count === 0 ? 0 : Math.max(boundariesMs.at(-1) ?? 1, 1),
    },
  };
}
