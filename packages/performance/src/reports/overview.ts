import * as Effect from 'effect/Effect';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { InitializeStore } from '../store/wire.js';
import type { StoredMetricRecord } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { OverviewPartialReason, OverviewSeries, PerformanceReportMeta } from '../protocol/reports.js';
import type { SegmentFailure } from '../SegmentCatalog.js';
import type { SegmentReader } from '../SegmentRing.js';
import { performanceRecord } from '../schema.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer } from './answer.js';
import { compareText, firstOf } from './page.js';
import type { HistogramTotal } from './metrics.js';
import { addHistogramDelta, compatibleMetrics, metricDelta, metricPercentile } from './metrics.js';
import { readRecord } from './record.js';

export const OVERVIEW_SAMPLE_PAGE = 200;

export const OVERVIEW_SAMPLE_BUDGET = 12_800;

export type OverviewKey = {
  readonly id: string;
  readonly name: string;
  readonly instanceId: string;
  readonly wallTime: number;
  readonly reader: SegmentReader;
};

export const compareOverviewRow = (left: OverviewKey, right: OverviewKey): number =>
  compareText(left.name, right.name) ||
  compareText(left.instanceId, right.instanceId) ||
  left.wallTime - right.wallTime ||
  compareText(left.id, right.id);

const makeOverviewKeys = ({
  readers,
  query,
}: {
  readonly readers: Readers;
  readonly query: Extract<PerformanceQuery, { readonly type: 'overview' }>;
}) => {
  const heads = new Map<SegmentReader, OverviewKey[]>();
  const cursors = new Map<SegmentReader, OverviewKey | undefined>();
  const drained = new Set<SegmentReader>();

  const refill = Effect.fnUntraced(function* (reader: SegmentReader) {
    const position = cursors.get(reader);
    const rows = yield* reader.db
      .select({
        id: performanceRecord.id,
        name: performanceRecord.name,
        instanceId: performanceRecord.instanceId,
        wallTime: performanceRecord.wallTime,
      })
      .from(performanceRecord)
      .where(
        and(
          eq(performanceRecord.kind, 'metric'),
          query.after === undefined ? undefined : gte(performanceRecord.name, query.after.name),
          gte(performanceRecord.wallTime, query.since),
          lt(performanceRecord.wallTime, query.until),
          position === undefined
            ? undefined
            : sql`(${performanceRecord.name}, ${performanceRecord.instanceId}, ${performanceRecord.wallTime}, ${performanceRecord.id}) > (${position.name}, ${position.instanceId}, ${position.wallTime}, ${position.id})`,
        ),
      )
      .orderBy(asc(performanceRecord.name), asc(performanceRecord.instanceId), asc(performanceRecord.wallTime), asc(performanceRecord.id))
      .limit(OVERVIEW_SAMPLE_PAGE);
    const keys = rows.flatMap((row) =>
      row.name === null ? [] : [{ id: row.id, name: row.name, instanceId: row.instanceId, wallTime: row.wallTime, reader }],
    );
    if (keys.length < OVERVIEW_SAMPLE_PAGE) drained.add(reader);
    if (keys.length > 0) cursors.set(reader, keys[keys.length - 1]);
    heads.set(reader, keys);
  });

  return {
    next: Effect.fnUntraced(function* () {
      for (const reader of readers) {
        if (drained.has(reader)) continue;
        const held = heads.get(reader);
        if (held !== undefined && held.length > 0) continue;
        yield* refill(reader);
      }
      let best: { readonly reader: SegmentReader; readonly key: OverviewKey } | undefined;
      for (const [reader, keys] of heads) {
        const head = keys[0];
        if (head === undefined) continue;
        if (best === undefined || compareOverviewRow(head, best.key) < 0) best = { reader, key: head };
      }
      if (best === undefined) return undefined;
      heads.get(best.reader)!.shift();
      return best.key;
    }),
  };
};

type OverviewCandidate = HistogramTotal & {
  readonly name: string;
  readonly reasons: Set<OverviewPartialReason>;
};

function recordsBoundaryChange(baseline: StoredMetricRecord, sample: StoredMetricRecord): boolean {
  return (
    baseline.payload.boundariesMs.length !== sample.payload.boundariesMs.length ||
    baseline.payload.boundariesMs.some((boundary, index) => boundary !== sample.payload.boundariesMs[index])
  );
}

function compareOverviewKeys(
  left: { readonly name: string; readonly boundaryKey: string },
  right: { readonly name: string; readonly boundaryKey: string },
): number {
  return compareText(left.name, right.name) || compareText(left.boundaryKey, right.boundaryKey);
}

export const readOverview = Effect.fn('PerformanceWorker.readOverview')(function* (
  readers: Readers,
  options: InitializeStore,
  query: Extract<PerformanceQuery, { readonly type: 'overview' }>,
  meta: PerformanceReportMeta,
) {
  const budget = options.maxReportSamples ?? OVERVIEW_SAMPLE_BUDGET;
  const candidates: OverviewCandidate[] = [];
  const byKey = new Map<string, OverviewCandidate>();
  let samplesRead = 0;
  let stoppedAtBudget = false;
  let observedFrom: number | undefined;
  let observedTo: number | undefined;
  let overflow = false;
  let run: { name: string; instanceId: string; previous: StoredMetricRecord } | undefined;
  let lastSample: StoredMetricRecord | undefined;

  const candidateFor = (record: StoredMetricRecord): OverviewCandidate | undefined => {
    const boundaryKey = JSON.stringify(record.payload.boundariesMs);
    const id = `${record.name} ${boundaryKey}`;
    const existing = byKey.get(id);
    if (existing !== undefined) return existing;
    if (query.after !== undefined && record.name === query.after.name && compareText(boundaryKey, query.after.boundaryKey) <= 0) {
      return undefined;
    }
    if (byKey.size > query.limit) {
      const largest = candidates[candidates.length - 1]!;
      if (compareOverviewKeys({ name: record.name, boundaryKey }, largest) > 0) {
        overflow = true;
        return undefined;
      }
      byKey.delete(`${largest.name} ${largest.boundaryKey}`);
      candidates.pop();
      overflow = true;
    }
    const candidate: OverviewCandidate = {
      name: record.name,
      boundaryKey,
      boundariesMs: record.payload.boundariesMs,
      bucketCounts: new Array(record.payload.bucketCounts.length).fill(0),
      count: 0,
      failures: 0,
      sumMs: 0,
      partial: false,
      reasons: new Set(),
    };
    byKey.set(id, candidate);
    const at = candidates.findIndex((entry) => compareOverviewKeys({ name: record.name, boundaryKey }, entry) < 0);
    if (at === -1) candidates.push(candidate);
    else candidates.splice(at, 0, candidate);
    return candidate;
  };

  const poison = (name: string, boundaryKey: string, reason: OverviewPartialReason): void => {
    if (query.after !== undefined && name === query.after.name && compareText(boundaryKey, query.after.boundaryKey) <= 0) {
      return;
    }
    byKey.get(`${name} ${boundaryKey}`)?.reasons.add(reason);
  };

  const opensInterval = (record: StoredMetricRecord): boolean => record.wallTime === query.since;

  const dropName = (name: string): void => {
    for (let at = candidates.length - 1; at >= 0; at -= 1) {
      const candidate = candidates[at]!;
      if (candidate.name !== name) continue;
      byKey.delete(`${candidate.name} ${candidate.boundaryKey}`);
      candidates.splice(at, 1);
    }
  };

  const foldChainStart = (record: StoredMetricRecord, baseline: StoredMetricRecord | undefined): void => {
    if (opensInterval(record)) {
      candidateFor(record);
    } else if (baseline !== undefined && compatibleMetrics(baseline, record)) {
      const candidate = candidateFor(record);
      if (candidate !== undefined) {
        addHistogramDelta(candidate, metricDelta(baseline, record), false);
        candidate.reasons.add('clipped-since');
      }
    } else if (baseline !== undefined) {
      candidateFor(record)?.reasons.add(recordsBoundaryChange(baseline, record) ? 'boundary-change' : 'reset');
    } else if (record.payload.count === 0) {
      candidateFor(record);
    } else {
      candidateFor(record)?.reasons.add('missing-baseline');
    }
  };

  const foldChained = (record: StoredMetricRecord, baseline: StoredMetricRecord): void => {
    if (compatibleMetrics(baseline, record)) {
      const candidate = candidateFor(record);
      if (candidate !== undefined) addHistogramDelta(candidate, metricDelta(baseline, record), false);
    } else {
      candidateFor(record)?.reasons.add(recordsBoundaryChange(baseline, record) ? 'boundary-change' : 'reset');
    }
  };

  const endRun = Effect.fn('PerformanceWorker.endOverviewRun')(function* () {
    const name = run?.name;
    const instanceId = run?.instanceId;
    const previous = lastSample;
    run = undefined;
    lastSample = undefined;
    if (name === undefined || instanceId === undefined || previous === undefined) return;
    const boundaryKey = JSON.stringify(previous.payload.boundariesMs);
    const successor = yield* firstOf(readers, (reader) =>
      reader.db
        .select()
        .from(performanceRecord)
        .where(
          and(
            eq(performanceRecord.kind, 'metric'),
            eq(performanceRecord.name, name),
            eq(performanceRecord.instanceId, instanceId),
            gte(performanceRecord.wallTime, query.until),
          ),
        )
        .orderBy(asc(performanceRecord.wallTime), asc(performanceRecord.id))
        .limit(1)
        .get(),
    );
    if (successor === undefined) {
      poison(name, boundaryKey, 'clipped-until');
      return;
    }
    const next = yield* readRecord(successor);
    if (next.kind !== 'metric') return yield* new PerformanceRecordUnreadable({ recordId: successor.id });
    samplesRead += 1;
    if (!compatibleMetrics(previous, next)) {
      poison(name, boundaryKey, 'clipped-until');
      poison(name, boundaryKey, recordsBoundaryChange(previous, next) ? 'boundary-change' : 'reset');
      return;
    }
    const crossing = metricDelta(previous, next);
    if (crossing.count > 0 || crossing.sumMs > 0) {
      poison(name, boundaryKey, 'clipped-until');
    }
  });

  const keys = makeOverviewKeys({ readers, query });
  while (true) {
    const key = yield* keys.next();
    if (key === undefined) {
      yield* endRun();
      break;
    }
    if (samplesRead >= budget) {
      if (run !== undefined && run.name !== key.name) yield* endRun();
      dropName(key.name);
      stoppedAtBudget = true;
      break;
    }
    if (candidates.length > query.limit && compareText(key.name, candidates[candidates.length - 1]!.name) > 0) {
      yield* endRun();
      break;
    }
    const row = yield* key.reader.db.select().from(performanceRecord).where(eq(performanceRecord.id, key.id)).get();
    if (row === undefined) return yield* new PerformanceRecordUnreadable({ recordId: key.id });
    const record = yield* readRecord(row);
    if (record.kind !== 'metric') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    samplesRead += 1;
    if (observedFrom === undefined || record.wallTime < observedFrom) observedFrom = record.wallTime;
    if (observedTo === undefined || record.wallTime > observedTo) observedTo = record.wallTime;
    if (run === undefined || run.name !== record.name || run.instanceId !== record.instanceId) {
      yield* endRun();
      const predecessor = opensInterval(record)
        ? undefined
        : yield* firstOf(readers, (reader) =>
            reader.db
              .select()
              .from(performanceRecord)
              .where(
                and(
                  eq(performanceRecord.kind, 'metric'),
                  eq(performanceRecord.name, record.name),
                  eq(performanceRecord.instanceId, record.instanceId),
                  lt(performanceRecord.wallTime, query.since),
                ),
              )
              .orderBy(desc(performanceRecord.wallTime), desc(performanceRecord.id))
              .limit(1)
              .get(),
          );
      let baseline: StoredMetricRecord | undefined;
      if (predecessor !== undefined) {
        const before = yield* readRecord(predecessor);
        if (before.kind !== 'metric') return yield* new PerformanceRecordUnreadable({ recordId: predecessor.id });
        samplesRead += 1;
        baseline = before;
      }
      run = { name: record.name, instanceId: record.instanceId, previous: record };
      foldChainStart(record, baseline);
    } else {
      foldChained(record, run.previous);
      run.previous = record;
    }
    lastSample = record;
  }

  const visible = candidates.slice(0, query.limit);
  const last = overflow || candidates.length > query.limit || stoppedAtBudget ? visible.at(-1) : undefined;
  const series: OverviewSeries[] = visible.map((candidate) => ({
    name: candidate.name,
    boundaryKey: candidate.boundaryKey,
    boundariesMs: [...candidate.boundariesMs],
    bucketCounts: [...candidate.bucketCounts],
    count: candidate.count,
    failures: candidate.failures,
    sumMs: candidate.sumMs,
    p50: candidate.count === 0 ? undefined : metricPercentile(candidate, 0.5),
    p99: candidate.count === 0 ? undefined : metricPercentile(candidate, 0.99),
    partial: candidate.reasons.size > 0,
    reasons: [...candidate.reasons].sort(),
  }));
  return {
    _tag: 'Found',
    report: {
      type: 'overview',
      ...meta,
      total: query.after === undefined && !overflow && !stoppedAtBudget && last === undefined ? series.length : null,
      since: query.since,
      until: query.until,
      observed: observedFrom === undefined || observedTo === undefined ? null : { from: observedFrom, to: observedTo },
      coverageReason: observedFrom === undefined && query.after === undefined && !stoppedAtBudget ? 'no-snapshots-in-interval' : null,
      samplesRead,
      series,
      stoppedAtBudget,
      next: last === undefined ? null : { name: last.name, boundaryKey: last.boundaryKey },
    },
  } satisfies ReportAnswer;
});
