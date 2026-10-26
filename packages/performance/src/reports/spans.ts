import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { StoredSpanRecord } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta } from '../protocol/reports.js';
import { spanTimingSchema } from '../protocol/records.js';
import { breakdownReportSchema } from '../protocol/reports.js';
import { performanceRecord } from '../schema.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer } from './answer.js';
import { compareText, fan, firstOf } from './page.js';
import { readRecord } from './record.js';

export const readSlow = Effect.fn('PerformanceWorker.readSlow')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'slow' }>,
  meta: PerformanceReportMeta,
) {
  const duration = sql<number>`${performanceRecord.monotonicEnd} - ${performanceRecord.monotonicStart}`;
  const conditions = [
    eq(performanceRecord.kind, 'span'),
    eq(performanceRecord.name, query.name),
    query.since === undefined ? undefined : gte(performanceRecord.wallTime, query.since),
    query.after === undefined
      ? undefined
      : or(
          lt(duration, query.after.durationMs),
          and(eq(duration, query.after.durationMs), gt(performanceRecord.wallTime, query.after.wallTime)),
          and(
            eq(duration, query.after.durationMs),
            eq(performanceRecord.wallTime, query.after.wallTime),
            gt(performanceRecord.id, query.after.id),
          ),
        ),
  ].filter((condition) => condition !== undefined);
  const rows = yield* fan(readers, (reader) =>
    reader.db
      .select()
      .from(performanceRecord)
      .where(and(...conditions))
      .orderBy(desc(duration), asc(performanceRecord.wallTime), asc(performanceRecord.id))
      .limit(query.limit + 1),
  );
  rows.sort(
    (left, right) =>
      right.monotonicEnd - right.monotonicStart - (left.monotonicEnd - left.monotonicStart) ||
      left.wallTime - right.wallTime ||
      compareText(left.id, right.id),
  );
  const visible = rows.slice(0, query.limit);
  const last = rows.length > query.limit ? visible.at(-1) : undefined;
  const spans: StoredSpanRecord[] = [];
  for (const row of visible) {
    const record = yield* readRecord(row);
    if (record.kind !== 'span') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    spans.push(record);
  }
  return {
    _tag: 'Found',
    report: {
      type: 'slow',
      ...meta,
      total: query.after === undefined && rows.length <= query.limit ? rows.length : null,
      spans,
      next:
        last === undefined
          ? null
          : {
              durationMs: last.monotonicEnd - last.monotonicStart,
              wallTime: last.wallTime,
              id: last.id,
            },
    },
  } satisfies ReportAnswer;
});

const timingColumns = {
  id: performanceRecord.id,
  instanceId: performanceRecord.instanceId,
  wallTime: performanceRecord.wallTime,
  monotonicStart: performanceRecord.monotonicStart,
  monotonicEnd: performanceRecord.monotonicEnd,
  traceId: performanceRecord.traceId,
  parentId: performanceRecord.parentId,
  name: performanceRecord.name,
  durationMs: sql<number>`${performanceRecord.monotonicEnd} - ${performanceRecord.monotonicStart}`,
};

type TimingRow = {
  readonly id: string;
  readonly instanceId: string;
  readonly wallTime: number;
  readonly monotonicStart: number;
  readonly monotonicEnd: number;
  readonly traceId: string | null;
  readonly parentId: string | null;
  readonly name: string | null;
  readonly durationMs: number;
};

const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_VALUE;

export const readBreakdown = Effect.fn('PerformanceWorker.readBreakdown')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'breakdown' }>,
  meta: PerformanceReportMeta,
) {
  const row = yield* firstOf(readers, (reader) =>
    reader.db
      .select(timingColumns)
      .from(performanceRecord)
      .where(and(eq(performanceRecord.id, query.id), eq(performanceRecord.kind, 'span')))
      .get(),
  );
  if (row === undefined) return { _tag: 'NotFound', query } satisfies ReportAnswer;
  const span = yield* Schema.decodeUnknownEffect(spanTimingSchema)(row).pipe(
    Effect.mapError(() => new PerformanceRecordUnreadable({ recordId: row.id })),
  );
  const children = yield* fan(readers, (reader) =>
    reader.db
      .select(timingColumns)
      .from(performanceRecord)
      .where(
        and(
          eq(performanceRecord.traceId, span.traceId),
          eq(performanceRecord.kind, 'span'),
          eq(performanceRecord.parentId, span.id),
          eq(performanceRecord.instanceId, span.instanceId),
        ),
      ),
  );
  const corrupt = children
    .filter(
      (child) =>
        !finite(child.monotonicStart) ||
        !finite(child.monotonicEnd) ||
        child.monotonicEnd < child.monotonicStart ||
        child.monotonicEnd - child.monotonicStart > Number.MAX_VALUE,
    )
    .map((child) => child.id)
    .sort(compareText)[0];
  if (corrupt !== undefined) return yield* new PerformanceRecordUnreadable({ recordId: corrupt });

  const ordered = [...children].sort((left, right) => left.monotonicStart - right.monotonicStart || compareText(left.id, right.id));
  let previousEnd: number | undefined;
  let coveredMs = 0;
  for (const child of ordered) {
    const from = Math.max(child.monotonicStart, span.monotonicStart, previousEnd ?? span.monotonicStart);
    const to = Math.min(child.monotonicEnd, span.monotonicEnd);
    coveredMs += Math.max(0, to - from);
    previousEnd = Math.max(previousEnd ?? child.monotonicEnd, child.monotonicEnd);
  }

  const after = query.after;
  const covered = (child: TimingRow): number =>
    Math.max(0, Math.min(child.monotonicEnd, span.monotonicEnd) - Math.max(child.monotonicStart, span.monotonicStart));
  const page = children
    .map((child) => ({ ...child, coveredMs: covered(child) }))
    .filter(
      (child) =>
        after === undefined ||
        child.coveredMs < after.coveredMs ||
        (child.coveredMs === after.coveredMs && compareText(child.id, after.id) > 0),
    )
    .sort((left, right) => right.coveredMs - left.coveredMs || compareText(left.id, right.id));
  const visible = page.slice(0, query.limit);
  const last = page.length > query.limit ? visible.at(-1) : undefined;
  const report = yield* Schema.decodeUnknownEffect(breakdownReportSchema)({
    type: 'breakdown',
    ...meta,
    span,
    coveredMs,
    selfMs: span.durationMs - coveredMs,
    totalChildren: children.length,
    evidence: 'retained-only',
    children: visible,
    next: last === undefined ? null : { coveredMs: last.coveredMs, id: last.id },
  }).pipe(Effect.mapError(() => new PerformanceRecordUnreadable({ recordId: span.id })));
  return { _tag: 'Found', report } satisfies ReportAnswer;
});

export const readTrace = Effect.fn('PerformanceWorker.readTrace')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'trace' }>,
  meta: PerformanceReportMeta,
) {
  const shape = yield* fan(readers, (reader) =>
    reader.db
      .select({
        id: performanceRecord.id,
        parentId: performanceRecord.parentId,
        instanceId: performanceRecord.instanceId,
        monotonicStart: performanceRecord.monotonicStart,
      })
      .from(performanceRecord)
      .where(and(eq(performanceRecord.traceId, query.traceId), eq(performanceRecord.kind, 'span'))),
  );
  shape.sort(
    (left, right) =>
      compareText(left.instanceId, right.instanceId) || left.monotonicStart - right.monotonicStart || compareText(left.id, right.id),
  );
  const covered = query.spanId === undefined ? shape : descendants(shape, query.spanId);
  const after = query.after;
  const wanted = covered
    .filter((row) =>
      after === undefined
        ? true
        : compareText(row.instanceId, after.instanceId) !== 0
          ? compareText(row.instanceId, after.instanceId) > 0
          : row.monotonicStart !== after.monotonicStart
            ? row.monotonicStart > after.monotonicStart
            : compareText(row.id, after.id) > 0,
    )
    .slice(0, query.limit + 1);
  const page = wanted.slice(0, query.limit);
  const last = wanted.length > query.limit ? page.at(-1) : undefined;
  const ids = page.map((row) => row.id);
  const rows =
    page.length === 0
      ? []
      : yield* fan(readers, (reader) => reader.db.select().from(performanceRecord).where(inArray(performanceRecord.id, ids)));
  rows.sort(
    (left, right) =>
      compareText(left.instanceId, right.instanceId) || left.monotonicStart - right.monotonicStart || compareText(left.id, right.id),
  );
  const grouped = new Map<string, StoredSpanRecord[]>();
  for (const row of rows) {
    const record = yield* readRecord(row);
    if (record.kind !== 'span') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    const spans = grouped.get(record.instanceId);
    if (spans === undefined) grouped.set(record.instanceId, [record]);
    else spans.push(record);
  }
  const segments = [...grouped.entries()]
    .map(([instanceId, spans]) => {
      const ids = new Set(spans.map((span) => span.id));
      return {
        instanceId,
        spans,
        rootIds: spans.flatMap((span) => (span.parentId === null || !ids.has(span.parentId) ? [span.id] : [])),
        earliestWallTime: spans.reduce((earliest, span) => Math.min(earliest, span.wallTime), Number.POSITIVE_INFINITY),
      };
    })
    .sort((left, right) => left.earliestWallTime - right.earliestWallTime || compareText(left.instanceId, right.instanceId))
    .map(({ earliestWallTime: _earliestWallTime, ...segment }) => segment);
  return {
    _tag: 'Found',
    report: {
      type: 'trace',
      ...meta,
      traceId: query.traceId,
      segments,
      totalSpans: covered.length,
      next: last === undefined ? null : { instanceId: last.instanceId, monotonicStart: last.monotonicStart, id: last.id },
    },
  } satisfies ReportAnswer;
});

const descendants = <Row extends { readonly id: string; readonly parentId: string | null }>(
  shape: readonly Row[],
  spanId: string,
): Row[] => {
  const children = new Map<string, Row[]>();
  for (const row of shape) {
    if (row.parentId === null) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  }
  const under = new Set<string>();
  const pending = [spanId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || under.has(id)) continue;
    under.add(id);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }
  return shape.filter((row) => under.has(row.id));
};
