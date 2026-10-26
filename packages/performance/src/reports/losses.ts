import * as Effect from 'effect/Effect';
import type { LossPayload, StoredLossRecord } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta } from '../protocol/reports.js';
import { countsOf, type Segment } from '../SegmentCatalog.js';
import type { SegmentRing } from '../SegmentRing.js';
import { PerformanceRecordUnreadable, type ReportAnswer } from './answer.js';
import { byTime, compareText, pageFrom, timePage } from './page.js';
import { readRecord } from './record.js';

const evictionLoss = (segment: Segment): StoredLossRecord | undefined => {
  const deletedAt = segment.deletedAt;
  if (deletedAt === null || segment.records === 0) return undefined;
  const kinds = countsOf(segment);
  if (Object.keys(kinds).length === 0) return undefined;
  return {
    id: `segment-${segment.startedAt}`,
    kind: 'loss',
    instanceId: segment.deletedBy ?? 'unknown',
    wallTime: deletedAt,
    monotonicStart: 0,
    monotonicEnd: 0,
    payload: {
      reason: 'stored-limit',
      kinds,
      range: { from: segment.firstWallTime, to: segment.lastWallTime },
    } satisfies LossPayload,
  };
};

export const readLosses = Effect.fn('PerformanceWorker.readLosses')(function* (
  ring: SegmentRing,
  query: Extract<PerformanceQuery, { readonly type: 'losses' }>,
  meta: PerformanceReportMeta,
) {
  const page = yield* timePage(yield* ring.readersFor(pageFrom(query), undefined), 'loss', query);
  const losses: StoredLossRecord[] = [];
  for (const row of page.rows) {
    const record = yield* readRecord(row);
    if (record.kind !== 'loss') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    losses.push(record);
  }
  const from = pageFrom(query);
  const after = query.after;
  for (const segment of ring.catalog.evicted) {
    const loss = evictionLoss(segment);
    if (loss === undefined) continue;
    if (from !== undefined && loss.wallTime < from) continue;
    if (
      after !== undefined &&
      (loss.wallTime < after.wallTime || (loss.wallTime === after.wallTime && compareText(loss.id, after.id) <= 0))
    ) {
      continue;
    }
    losses.push(loss);
  }
  losses.sort(byTime);
  const visible = losses.slice(0, query.limit);
  const last = losses.length > query.limit || page.next !== null ? visible.at(-1) : undefined;
  return {
    _tag: 'Found',
    report: {
      type: 'losses',
      ...meta,
      losses: visible,
      next: last === undefined ? null : { wallTime: last.wallTime, id: last.id },
    },
  } satisfies ReportAnswer;
});
