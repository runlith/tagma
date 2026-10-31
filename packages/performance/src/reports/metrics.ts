import * as Effect from 'effect/Effect';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { StoredMetricRecord } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { MetricHour, PerformanceReportMeta } from '../protocol/reports.js';
import { metricPercentile, type HistogramCounts } from '../Histogram.js';
import { performanceRecord } from '../schema.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer, type Row } from './answer.js';
import { compareText, fan, firstOf, HOUR_MS } from './page.js';
import { readRecord } from './record.js';

export type HistogramTotal = HistogramCounts & {
  readonly boundaryKey: string;
  readonly bucketCounts: number[];
  count: number;
  failures: number;
  sumMs: number;
  partial: boolean;
};

export type MetricAggregate = HistogramTotal & {
  readonly hourStart: number;
};

export type MetricDelta = {
  readonly bucketCounts: ReadonlyArray<number>;
  readonly count: number;
  readonly failures: number;
  readonly sumMs: number;
};

export function metricDelta(baseline: StoredMetricRecord, sample: StoredMetricRecord): MetricDelta {
  return {
    bucketCounts: sample.payload.bucketCounts.map((count, index) => count - baseline.payload.bucketCounts[index]!),
    count: sample.payload.count - baseline.payload.count,
    failures: sample.payload.failures - baseline.payload.failures,
    sumMs: sample.payload.sumMs - baseline.payload.sumMs,
  };
}

export function addHistogramDelta(total: HistogramTotal, delta: MetricDelta, partial: boolean): void {
  for (let index = 0; index < delta.bucketCounts.length; index += 1) {
    total.bucketCounts[index]! += delta.bucketCounts[index]!;
  }
  total.count += delta.count;
  total.failures += delta.failures;
  total.sumMs += delta.sumMs;
  total.partial ||= partial;
}

export const readMetrics = Effect.fn('PerformanceWorker.readMetrics')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'metrics' }>,
  meta: PerformanceReportMeta,
) {
  const collected: MetricAggregate[] = [];
  const sinceHour = query.since === undefined ? undefined : Math.floor(query.since / HOUR_MS) * HOUR_MS;
  let nextHourStart =
    sinceHour === undefined ? query.after?.hourStart : query.after === undefined ? sinceHour : Math.max(sinceHour, query.after.hourStart);

  while (collected.length <= query.limit) {
    const hourStart = sql<number>`cast(${performanceRecord.wallTime} / ${HOUR_MS} as integer) * ${HOUR_MS}`;
    const found = yield* fan(readers, (reader) =>
      reader.db
        .select({ hourStart })
        .from(performanceRecord)
        .where(
          and(
            eq(performanceRecord.kind, 'metric'),
            eq(performanceRecord.name, query.name),
            nextHourStart === undefined ? undefined : gte(performanceRecord.wallTime, nextHourStart),
          ),
        )
        .groupBy(hourStart)
        .orderBy(asc(hourStart))
        .limit(query.limit + 1),
    );
    const rows = [...new Set(found.map((row) => row.hourStart))]
      .sort((left, right) => left - right)
      .slice(0, query.limit + 1)
      .map((value) => ({ hourStart: value }));
    if (rows.length === 0) break;

    for (const row of rows) {
      for (const aggregate of yield* readMetricHour(readers, query.name, row.hourStart, query.since)) {
        if (
          query.after !== undefined &&
          (aggregate.hourStart < query.after.hourStart ||
            (aggregate.hourStart === query.after.hourStart && compareText(aggregate.boundaryKey, query.after.boundaryKey) <= 0))
        ) {
          continue;
        }
        collected.push(aggregate);
        if (collected.length > query.limit) break;
      }
      if (collected.length > query.limit) break;
    }
    if (collected.length > query.limit || rows.length < query.limit + 1) break;
    const lastHour = rows.at(-1);
    if (lastHour === undefined) break;
    nextHourStart = lastHour.hourStart + HOUR_MS;
  }

  const visible = collected.slice(0, query.limit);
  const last = collected.length > query.limit ? visible.at(-1) : undefined;
  const hours: MetricHour[] = visible.map((hour) => ({
    ...hour,
    p50: metricPercentile(hour, 0.5),
    p99: metricPercentile(hour, 0.99),
  }));
  return {
    _tag: 'Found',
    report: {
      type: 'metrics',
      ...meta,
      hours,
      next: last === undefined ? null : { hourStart: last.hourStart, boundaryKey: last.boundaryKey },
    },
  } satisfies ReportAnswer;
});

export const readMetricHour = Effect.fn('PerformanceWorker.readMetricHour')(function* (
  readers: Readers,
  name: string,
  hourStart: number,
  since: number | undefined,
) {
  const rowStart = since === undefined ? hourStart : Math.max(hourStart, since);
  const rows = yield* fan(readers, (reader) =>
    reader.db
      .select()
      .from(performanceRecord)
      .where(
        and(
          eq(performanceRecord.kind, 'metric'),
          eq(performanceRecord.name, name),
          gte(performanceRecord.wallTime, rowStart),
          lt(performanceRecord.wallTime, hourStart + HOUR_MS),
        ),
      ),
  );

  for (const instanceId of [...new Set(rows.map((row) => row.instanceId))]) {
    const predecessor = yield* firstOf(readers, (reader) =>
      reader.db
        .select()
        .from(performanceRecord)
        .where(
          and(
            eq(performanceRecord.kind, 'metric'),
            eq(performanceRecord.name, name),
            eq(performanceRecord.instanceId, instanceId),
            lt(performanceRecord.wallTime, rowStart),
          ),
        )
        .orderBy(desc(performanceRecord.wallTime), desc(performanceRecord.monotonicStart), desc(performanceRecord.id))
        .limit(1)
        .get(),
    );
    if (predecessor !== undefined) rows.push(predecessor);
  }

  const samples: StoredMetricRecord[] = [];
  for (const row of rows.sort(compareRows)) {
    const record = yield* readRecord(row);
    if (record.kind !== 'metric') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    samples.push(record);
  }

  const aggregates = new Map<string, MetricAggregate>();
  const partialBoundaries = new Set<string>();
  let previous: StoredMetricRecord | undefined;
  let segmentPartial = true;
  for (const sample of samples) {
    if (previous === undefined || previous.instanceId !== sample.instanceId) {
      previous = sample;
      segmentPartial = true;
      continue;
    }
    if (!compatibleMetrics(previous, sample)) {
      previous = sample;
      segmentPartial = true;
      continue;
    }

    const baseline = previous;
    const delta = metricDelta(baseline, sample);
    const sampleHour = Math.floor(sample.wallTime / HOUR_MS) * HOUR_MS;
    const previousHour = Math.floor(baseline.wallTime / HOUR_MS) * HOUR_MS;
    const boundaryKey = JSON.stringify(sample.payload.boundariesMs);
    const partial = segmentPartial || previousHour !== sampleHour || (since !== undefined && baseline.wallTime < since);
    segmentPartial = false;
    previous = sample;
    if (sampleHour !== hourStart) continue;

    const existing = aggregates.get(boundaryKey);
    if (delta.count === 0) {
      if (partial) partialBoundaries.add(boundaryKey);
      if (existing !== undefined && partial) existing.partial = true;
      continue;
    }
    if (existing === undefined) {
      aggregates.set(boundaryKey, {
        hourStart,
        boundaryKey,
        boundariesMs: sample.payload.boundariesMs,
        bucketCounts: [...delta.bucketCounts],
        count: delta.count,
        failures: delta.failures,
        sumMs: delta.sumMs,
        partial: partial || partialBoundaries.has(boundaryKey),
      });
      continue;
    }
    addHistogramDelta(existing, delta, partial || partialBoundaries.has(boundaryKey));
  }

  return [...aggregates.values()].sort((left, right) => compareText(left.boundaryKey, right.boundaryKey));
});

function compareRows(left: Row, right: Row): number {
  return (
    compareText(left.instanceId, right.instanceId) ||
    left.wallTime - right.wallTime ||
    left.monotonicStart - right.monotonicStart ||
    compareText(left.id, right.id)
  );
}

export function compatibleMetrics(previous: StoredMetricRecord, current: StoredMetricRecord): boolean {
  return (
    previous.payload.boundariesMs.length === current.payload.boundariesMs.length &&
    previous.payload.boundariesMs.every((boundary, index) => boundary === current.payload.boundariesMs[index]) &&
    previous.payload.bucketCounts.length === current.payload.bucketCounts.length &&
    current.payload.bucketCounts.every((count, index) => count >= previous.payload.bucketCounts[index]!) &&
    current.payload.count >= previous.payload.count &&
    current.payload.failures >= previous.payload.failures &&
    current.payload.failures - previous.payload.failures <= current.payload.count - previous.payload.count &&
    current.payload.sumMs >= previous.payload.sumMs
  );
}
