import * as Effect from 'effect/Effect';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { takeMemoryReading } from '../MemoryReading.js';
import type { StoredMemoryRecord } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { MemoryGrowthThread, PerformanceReportMeta } from '../protocol/reports.js';
import type { SegmentRing } from '../SegmentRing.js';
import { performanceRecord } from '../schema.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer } from './answer.js';
import { compareText, firstOf, timePage } from './page.js';
import { readRecord } from './record.js';

export const readMemory = Effect.fn('PerformanceWorker.readMemory')(function* (ring: SegmentRing, meta: PerformanceReportMeta) {
  const readers = yield* ring.all;
  let pageBytes = 0;
  let pageCount = 0;
  let freePages = 0;
  for (const reader of readers) {
    const size = (yield* reader.db.all<{ page_size: number }>(sql`PRAGMA page_size`))[0]?.page_size ?? 0;
    pageBytes = Math.max(pageBytes, size);
    pageCount += (yield* reader.db.all<{ page_count: number }>(sql`PRAGMA page_count`))[0]?.page_count ?? 0;
    freePages += (yield* reader.db.all<{ freelist_count: number }>(sql`PRAGMA freelist_count`))[0]?.freelist_count ?? 0;
  }
  const writer = ring.writer;
  const cacheSize = writer === undefined ? 0 : ((yield* writer.all<{ cache_size: number }>(sql`PRAGMA cache_size`))[0]?.cache_size ?? 0);
  const mmapBytes = writer === undefined ? 0 : ((yield* writer.all<{ mmap_size: number }>(sql`PRAGMA mmap_size`))[0]?.mmap_size ?? 0);
  return {
    _tag: 'Found',
    report: {
      type: 'memory',
      ...meta,
      threads: [takeMemoryReading('store-worker')],
      store: { pendingBytes: 0, pendingRecords: 0 },
      database: {
        path: ring.root,
        fileBytes: pageCount * pageBytes + ring.logBytes,
        pageBytes,
        pageCount,
        freePages,
        cacheBytes: cacheSize < 0 ? Math.abs(cacheSize) * 1024 : cacheSize * pageBytes,
        mmapBytes,
        logBytes: ring.logBytes,
      },
    },
  } satisfies ReportAnswer;
});

export const readCaptures = Effect.fn('PerformanceWorker.readCaptures')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'captures' }>,
  meta: PerformanceReportMeta,
) {
  const page = yield* timePage(readers, 'memory', query);
  const captures: StoredMemoryRecord[] = [];
  for (const row of page.rows) {
    const record = yield* readRecord(row);
    if (record.kind !== 'memory') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    captures.push(record);
  }
  return { _tag: 'Found', report: { type: 'captures', ...meta, captures, next: page.next } } satisfies ReportAnswer;
});

const captureById = Effect.fn('PerformanceWorker.captureById')(function* (readers: Readers, id: string) {
  const row = yield* firstOf(readers, (reader) =>
    reader.db
      .select()
      .from(performanceRecord)
      .where(and(eq(performanceRecord.id, id), eq(performanceRecord.kind, 'memory')))
      .get(),
  );
  if (row === undefined) return undefined;
  const record = yield* readRecord(row);
  if (record.kind !== 'memory') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
  return record;
});

const growthOf = (from: StoredMemoryRecord, to: StoredMemoryRecord): MemoryGrowthThread[] => {
  const earlier = new Map(from.payload.threads.map((thread) => [thread.thread, thread]));
  return to.payload.threads.flatMap((after) => {
    const before = earlier.get(after.thread);
    if (before === undefined) return [];
    const counts = new Map(before.largestTypes.map((type) => [type.name, type.count]));
    const seen = new Set<string>();
    const types = after.largestTypes.map((type) => {
      seen.add(type.name);
      const start = counts.get(type.name) ?? 0;
      return { name: type.name, before: start, after: type.count, delta: type.count - start };
    });
    for (const type of before.largestTypes) {
      if (!seen.has(type.name)) types.push({ name: type.name, before: type.count, after: 0, delta: -type.count });
    }
    const committed =
      after.process.allocator === undefined || before.process.allocator === undefined
        ? undefined
        : after.process.allocator.committedBytes - before.process.allocator.committedBytes;
    return [
      {
        thread: after.thread,
        rssDeltaBytes: after.process.rssBytes - before.process.rssBytes,
        heapUsedDeltaBytes: after.process.heapUsedBytes - before.process.heapUsedBytes,
        heapSizeDeltaBytes: after.heap.sizeBytes - before.heap.sizeBytes,
        objectCountDelta: after.heap.objectCount - before.heap.objectCount,
        committedDeltaBytes: committed,
        types: types.sort((left, right) => right.delta - left.delta || compareText(left.name, right.name)),
      } satisfies MemoryGrowthThread,
    ];
  });
};

export const readGrowth = Effect.fn('PerformanceWorker.readGrowth')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'growth' }>,
  meta: PerformanceReportMeta,
) {
  const to = yield* captureById(readers, query.id);
  if (to === undefined) return { _tag: 'NotFound', query } satisfies ReportAnswer;
  const against = query.against;
  if (against !== undefined) {
    const from = yield* captureById(readers, against);
    if (from === undefined) {
      return { _tag: 'NotFound', query: { type: 'growth', id: against } } satisfies ReportAnswer;
    }
    return growthAnswer(from, to, meta);
  }
  const previous = yield* firstOf(readers, (reader) =>
    reader.db
      .select()
      .from(performanceRecord)
      .where(
        and(
          eq(performanceRecord.kind, 'memory'),
          eq(performanceRecord.instanceId, to.instanceId),
          or(
            lt(performanceRecord.wallTime, to.wallTime),
            and(eq(performanceRecord.wallTime, to.wallTime), lt(performanceRecord.id, to.id)),
          ),
        ),
      )
      .orderBy(desc(performanceRecord.wallTime), desc(performanceRecord.id))
      .limit(1)
      .get(),
  );
  if (previous === undefined) return { _tag: 'NotFound', query } satisfies ReportAnswer;
  const from = yield* readRecord(previous);
  if (from.kind !== 'memory') return yield* new PerformanceRecordUnreadable({ recordId: previous.id });
  return growthAnswer(from, to, meta);
});

const growthAnswer = (from: StoredMemoryRecord, to: StoredMemoryRecord, meta: PerformanceReportMeta): ReportAnswer => ({
  _tag: 'Found',
  report: {
    type: 'growth',
    ...meta,
    from,
    to,
    elapsedMs: Math.max(0, to.wallTime - from.wallTime),
    threads: from.instanceId === to.instanceId ? growthOf(from, to) : [],
  },
});
