import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { StoredSpanRecord, StoredStallRecord, StoredVitalRecord } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta, StallCaller, StallOverlap, StallReading } from '../protocol/reports.js';
import { stallCause } from '../protocol/records.js';
import { cpuProfileArtifactSchema, stallSampling, type ProfileInterval, type StallSampling } from '../CpuProfile.js';
import type { SegmentRing } from '../SegmentRing.js';
import { performanceRecord } from '../schema.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer } from './answer.js';
import { compareText, fan, firstOf, pageFrom, timePage } from './page.js';
import { readRecord } from './record.js';

const samplingOfStalls = Effect.fn('PerformanceWorker.samplingOfStalls')(function* (
  readers: Readers,
  stalls: ReadonlyArray<StoredStallRecord>,
) {
  const sampled = new Map<string, StallSampling>();
  const wanted = stalls.flatMap((stall) => (stall.payload.profileId === undefined ? [] : [stall.payload.profileId]));
  if (wanted.length === 0) return sampled;
  const ids = [...new Set(wanted)];
  const rows = yield* fan(readers, (reader) =>
    reader.db
      .select({
        id: performanceRecord.id,
        monotonicStart: performanceRecord.monotonicStart,
        monotonicEnd: performanceRecord.monotonicEnd,
        payload: performanceRecord.payload,
      })
      .from(performanceRecord)
      .where(and(eq(performanceRecord.kind, 'profile'), inArray(performanceRecord.id, ids))),
  );
  for (const row of rows) {
    const artifact = yield* Effect.try(() => (JSON.parse(row.payload) as { readonly profile: unknown }).profile).pipe(
      Effect.flatMap((profile) => Schema.decodeUnknownEffect(cpuProfileArtifactSchema)(profile)),
      Effect.option,
    );
    if (artifact._tag === 'None') continue;
    for (const stall of stalls) {
      if (stall.payload.profileId !== row.id) continue;
      const sampling = stallSampling(artifact.value, row, stall);
      if (sampling !== undefined) sampled.set(stall.id, sampling);
    }
  }
  return sampled;
});

type CoveringSpan = {
  readonly name: string;
  readonly runId: string;
  readonly threadId?: string | undefined;
  readonly toolName?: string | undefined;
  readonly toolCallId?: string | undefined;
  readonly monotonicStart: number;
  readonly monotonicEnd: number;
};

const attributeText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const coveringSpan = (span: StoredSpanRecord): CoveringSpan | undefined => {
  const runId = attributeText(span.payload.attributes['run.id']);
  if (runId === undefined) return undefined;
  return {
    name: span.name,
    runId,
    threadId: attributeText(span.payload.attributes['thread.id']),
    toolName: attributeText(span.payload.attributes['tool.name']),
    toolCallId: attributeText(span.payload.attributes['tool.call.id']),
    monotonicStart: span.monotonicStart,
    monotonicEnd: span.monotonicEnd,
  };
};

const callersOf = (spans: ReadonlyArray<CoveringSpan>, stall: ProfileInterval): StallCaller[] =>
  spans
    .flatMap((span) => {
      const coveredMs = Math.min(span.monotonicEnd, stall.monotonicEnd) - Math.max(span.monotonicStart, stall.monotonicStart);
      if (coveredMs < 0) return [];
      return [
        {
          name: span.name,
          runId: span.runId,
          threadId: span.threadId,
          toolName: span.toolName,
          toolCallId: span.toolCallId,
          coveredMs,
          durationMs: Math.max(0, span.monotonicEnd - span.monotonicStart),
        } satisfies StallCaller,
      ];
    })
    .sort(
      (left, right) =>
        right.coveredMs - left.coveredMs ||
        left.durationMs - right.durationMs ||
        compareText(left.name, right.name) ||
        compareText(left.runId, right.runId),
    );

const attribute = (key: string) => sql<unknown>`json_extract(${performanceRecord.payload}, '$.attributes."${sql.raw(key)}"')`;

type CallerRow = {
  readonly name: string | null;
  readonly monotonicStart: number;
  readonly monotonicEnd: number;
  readonly runId: unknown;
  readonly threadId: unknown;
  readonly toolName: unknown;
  readonly toolCallId: unknown;
};

const callersOfStalls = Effect.fn('PerformanceWorker.callersOfStalls')(function* (
  readers: Readers,
  stalls: ReadonlyArray<StoredStallRecord>,
) {
  const callers = new Map<string, StallCaller[]>();
  if (stalls.length === 0) return callers;
  const byInstance = new Map<string, StoredStallRecord[]>();
  for (const stall of stalls) {
    const own = byInstance.get(stall.instanceId);
    if (own === undefined) byInstance.set(stall.instanceId, [stall]);
    else own.push(stall);
  }
  for (const [instanceId, own] of byInstance) {
    const windowStart = Math.min(...own.map((stall) => stall.monotonicStart));
    const windowEnd = Math.max(...own.map((stall) => stall.monotonicEnd));
    const rows = yield* fan(readers, (reader) =>
      reader.db.all<CallerRow>(sql`
            select name as "name",
              monotonic_start as "monotonicStart", monotonic_end as "monotonicEnd",
              run_id as "runId",
              ${attribute('thread.id')} as "threadId",
              ${attribute('tool.name')} as "toolName",
              ${attribute('tool.call.id')} as "toolCallId"
            from performance_record
            where kind = 'span' and run_id is not null
              and instance_id = ${instanceId}
              and monotonic_start <= ${windowEnd} and monotonic_end >= ${windowStart}
          `),
    );
    const spans = rows.flatMap((row): CoveringSpan[] => {
      const run = attributeText(row.runId);
      if (run === undefined || row.name === null) return [];
      return [
        {
          name: row.name,
          runId: run,
          threadId: attributeText(row.threadId),
          toolName: attributeText(row.toolName),
          toolCallId: attributeText(row.toolCallId),
          monotonicStart: row.monotonicStart,
          monotonicEnd: row.monotonicEnd,
        },
      ];
    });
    for (const stall of own) {
      const covering = spans.filter((span) => span.monotonicStart <= stall.monotonicEnd && span.monotonicEnd >= stall.monotonicStart);
      callers.set(stall.id, callersOf(covering, stall));
    }
  }
  return callers;
});

export const readStalls = Effect.fn('PerformanceWorker.readStalls')(function* (
  ring: SegmentRing,
  query: Extract<PerformanceQuery, { readonly type: 'stalls' }>,
  meta: PerformanceReportMeta,
) {
  const page = yield* timePage(yield* ring.readersFor(pageFrom(query), undefined), 'stall', query);
  const records: StoredStallRecord[] = [];
  for (const row of page.rows) {
    const record = yield* readRecord(row);
    if (record.kind !== 'stall') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    records.push(record);
  }
  const everywhere = yield* ring.all;
  const sampled = yield* samplingOfStalls(everywhere, records);
  const callers = yield* callersOfStalls(everywhere, records);
  const stalls: StallReading[] = records.map((stall) => ({
    stall,
    cause: stallCause(stall.payload),
    sampling: sampled.get(stall.id) ?? null,
    caller: callers.get(stall.id)?.[0] ?? null,
  }));
  return { _tag: 'Found', report: { type: 'stalls', ...meta, stalls, next: page.next } } satisfies ReportAnswer;
});

export const readStall = Effect.fn('PerformanceWorker.readStall')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'stall' }>,
  meta: PerformanceReportMeta,
) {
  const row = yield* firstOf(readers, (reader) =>
    reader.db
      .select()
      .from(performanceRecord)
      .where(and(eq(performanceRecord.id, query.id), eq(performanceRecord.kind, 'stall')))
      .get(),
  );
  if (row === undefined) return { _tag: 'NotFound', query } satisfies ReportAnswer;
  const stall = yield* readRecord(row);
  if (stall.kind !== 'stall') return yield* new PerformanceRecordUnreadable({ recordId: row.id });

  const overlaps = yield* fan(readers, (reader) =>
    reader.db
      .select()
      .from(performanceRecord)
      .where(
        and(
          eq(performanceRecord.instanceId, stall.instanceId),
          inArray(performanceRecord.kind, ['span', 'vital']),
          lte(performanceRecord.monotonicStart, stall.monotonicEnd),
          gte(performanceRecord.monotonicEnd, stall.monotonicStart),
        ),
      )
      .orderBy(asc(performanceRecord.kind), asc(performanceRecord.wallTime), asc(performanceRecord.id)),
  );
  overlaps.sort((left, right) => compareText(left.kind, right.kind) || left.wallTime - right.wallTime || compareText(left.id, right.id));
  const allSpans: StoredSpanRecord[] = [];
  const vitals: StoredVitalRecord[] = [];
  for (const overlap of overlaps) {
    const record = yield* readRecord(overlap);
    if (record.kind === 'span') allSpans.push(record);
    else if (record.kind === 'vital') vitals.push(record);
    else return yield* new PerformanceRecordUnreadable({ recordId: overlap.id });
  }

  const folded = new Map<string, StallOverlap>();
  for (const span of allSpans) {
    const durationMs = span.monotonicEnd - span.monotonicStart;
    const current = folded.get(span.name);
    folded.set(
      span.name,
      current === undefined
        ? { name: span.name, count: 1, totalMs: durationMs, maxMs: durationMs }
        : {
            name: span.name,
            count: current.count + 1,
            totalMs: current.totalMs + durationMs,
            maxMs: Math.max(current.maxMs, durationMs),
          },
    );
  }
  const overlap = [...folded.values()].sort((left, right) => right.totalMs - left.totalMs || compareText(left.name, right.name));
  const after = query.after;
  const remaining =
    after === undefined
      ? allSpans
      : allSpans.filter(
          (span) => span.wallTime > after.wallTime || (span.wallTime === after.wallTime && compareText(span.id, after.id) > 0),
        );
  const spans = query.limit === undefined ? [] : remaining.slice(0, query.limit);
  const last = query.limit !== undefined && remaining.length > query.limit ? spans.at(-1) : undefined;
  return {
    _tag: 'Found',
    report: {
      type: 'stall',
      ...meta,
      stall,
      cause: stallCause(stall.payload),
      sampling: (yield* samplingOfStalls(readers, [stall])).get(stall.id) ?? null,
      callers: callersOf(
        allSpans.flatMap((span) => coveringSpan(span) ?? []),
        stall,
      ),
      overlap,
      spans,
      vitals,
      next: last === undefined ? null : { wallTime: last.wallTime, id: last.id },
    },
  } satisfies ReportAnswer;
});
