import { Context, Fiber } from 'effect';
import { costRootId, CurrentCost } from './CostLedger.js';
import { metricPercentile } from './Histogram.js';
import type { WriterUnitsReport, WriterMetricsReport } from './protocol/reports.js';
import type { WriterUnitsQuery, WriterMetricsQuery } from './protocol/queries.js';

type UnitsRead = Omit<WriterUnitsQuery, 'type'>;
type MetricsRead = Omit<WriterMetricsQuery, 'type'>;
type UnitsPage = Omit<WriterUnitsReport, 'type'>;
type MetricsPage = Omit<WriterMetricsReport, 'type'>;
type WriterUnit = WriterUnitsReport['rows'][number];
type OperationReading = WriterMetricsReport['rows'][number];
type HistogramReading = OperationReading['wait'];
type WriterOutcome = WriterUnit['outcome'];

export type WriterFrame = {
  readonly operation: string;
  readonly store: string;
  readonly rootId: string | null;
  owner: object | null;
  acquired: boolean;
  waitMs: number;
  holdMs: number;
  childMs: number;
  repliesComplete: boolean;
  commitReturnedAt: number | null;
  writerPid: number | null;
};

export const CurrentWriter = Context.Reference<WriterFrame | null>('@runlith/performance/CurrentWriter', { defaultValue: () => null });

export class WriterMetrics extends Context.Service<
  WriterMetrics,
  {
    readonly begin: (operation: string, store: string) => WriterFrame;
    readonly end: (frame: WriterFrame, outcome: WriterOutcome) => void;
    readonly units: (query: UnitsRead) => UnitsPage;
    readonly metrics: (query: MetricsRead) => MetricsPage;
  }
>()('@runlith/performance/WriterMetrics') {}

const BOUNDARIES = [
  0, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 500, 1000, 2000, 5000,
  10000, 30000, 60000, 300000, 900000,
];

type Histogram = { count: number; sumMs: number; readonly bucketCounts: number[] };
type Operation = {
  readonly operation: string;
  readonly series: number;
  readonly sinceSequence: number;
  latestSequence: number;
  count: number;
  failures: number;
  interruptions: number;
  incomplete: number;
  readonly wait: Histogram;
  readonly hold: Histogram;
  readonly child: Histogram;
  readonly outside: Histogram;
};

const histogram = (): Histogram => ({ count: 0, sumMs: 0, bucketCounts: new Array<number>(BOUNDARIES.length + 1).fill(0) });
const observe = (histogram: Histogram, value: number): void => {
  let low = 0;
  let high = BOUNDARIES.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (value <= BOUNDARIES[middle]!) high = middle;
    else low = middle + 1;
  }
  histogram.count++;
  histogram.sumMs += value;
  histogram.bucketCounts[low]!++;
};
const reading = (histogram: Histogram): HistogramReading => {
  const counts = { ...histogram, boundariesMs: BOUNDARIES };
  return {
    ...histogram,
    bucketCounts: [...histogram.bucketCounts],
    p50: histogram.count === 0 ? null : metricPercentile(counts, 0.5),
    p99: histogram.count === 0 ? null : metricPercentile(counts, 0.99),
  };
};

export const makeWriterMetrics = (input: { readonly units: number; readonly operations: number }) => {
  const writerId = crypto.randomUUID();
  const units = new Map<number, WriterUnit>();
  const operations = new Map<string, Operation>();
  const unitCapacity = Math.max(1, Math.floor(input.units));
  const operationCapacity = Math.max(1, Math.floor(input.operations));
  let sequence = 0;
  let series = 0;
  let evicted = 0;
  let evictedOperations = 0;
  const cursor = () => ({ writerId, sequence });
  return WriterMetrics.of({
    begin: (operation, store) => {
      const cause = Fiber.getCurrent()?.getRef(CurrentCost) ?? null;
      return {
        operation,
        store,
        rootId: cause === null ? null : costRootId(cause),
        owner: null,
        acquired: false,
        waitMs: 0,
        holdMs: 0,
        childMs: 0,
        repliesComplete: true,
        commitReturnedAt: null,
        writerPid: null,
      };
    },
    end: (frame, outcome) => {
      const complete = frame.repliesComplete && frame.childMs <= frame.holdMs;
      const row: WriterUnit = {
        sequence: ++sequence,
        rootId: frame.rootId,
        operation: frame.operation,
        store: frame.store,
        outcome,
        acquired: frame.acquired,
        waitMs: frame.waitMs,
        holdMs: frame.holdMs,
        childMs: complete ? frame.childMs : null,
        outsideMs: complete ? frame.holdMs - frame.childMs : null,
        commitReturnedAt: frame.commitReturnedAt,
        writerPid: frame.writerPid,
      };
      units.set(sequence, row);
      if (units.size > unitCapacity) {
        units.delete(units.keys().next().value!);
        evicted++;
      }
      let held = operations.get(frame.operation);
      if (held === undefined) {
        held = {
          operation: frame.operation,
          series: ++series,
          sinceSequence: sequence,
          latestSequence: sequence,
          count: 0,
          failures: 0,
          interruptions: 0,
          incomplete: 0,
          wait: histogram(),
          hold: histogram(),
          child: histogram(),
          outside: histogram(),
        };
        operations.set(frame.operation, held);
        if (operations.size > operationCapacity) {
          operations.delete(operations.keys().next().value!);
          evictedOperations++;
        }
      }
      held.latestSequence = sequence;
      held.count++;
      if (outcome === 'failure') held.failures++;
      if (outcome === 'interrupted') held.interruptions++;
      observe(held.wait, frame.waitMs);
      observe(held.hold, frame.holdMs);
      if (row.childMs === null || row.outsideMs === null) held.incomplete++;
      else {
        observe(held.child, row.childMs);
        observe(held.outside, row.outsideMs);
      }
    },
    units: (query) => {
      const reset = query.after !== undefined && query.after.writerId !== writerId;
      const after = reset ? 0 : (query.after?.sequence ?? 0);
      const oldestSequence = units.keys().next().value ?? sequence + 1;
      const rows: WriterUnit[] = [];
      let total = 0;
      let more = false;
      for (const row of units.values()) {
        if (
          (query.rootId !== undefined && row.rootId !== query.rootId) ||
          (query.operation !== undefined && row.operation !== query.operation)
        )
          continue;
        total++;
        if (row.sequence <= after) continue;
        if (rows.length < query.limit) rows.push({ ...row });
        else more = true;
      }
      return {
        writerId,
        reset,
        gap: !reset && query.after !== undefined && after < oldestSequence - 1,
        oldestSequence,
        cursor: cursor(),
        total,
        evicted,
        rows,
        next: more ? { writerId, sequence: rows.at(-1)!.sequence } : null,
      };
    },
    metrics: (query) => {
      const reset = query.after !== undefined && query.after.writerId !== writerId;
      const after = reset ? 0 : (query.after?.series ?? 0);
      const rows: OperationReading[] = [];
      let total = 0;
      let more = false;
      for (const held of operations.values()) {
        if (query.operation !== undefined && held.operation !== query.operation) continue;
        total++;
        if (held.series <= after) continue;
        if (rows.length < query.limit)
          rows.push({
            ...held,
            wait: reading(held.wait),
            hold: reading(held.hold),
            child: reading(held.child),
            outside: reading(held.outside),
          });
        else more = true;
      }
      return {
        writerId,
        reset,
        cursor: cursor(),
        evictedOperations,
        total,
        boundariesMs: [...BOUNDARIES],
        rows,
        next: more ? { writerId, series: rows.at(-1)!.series } : null,
      };
    },
  });
};
