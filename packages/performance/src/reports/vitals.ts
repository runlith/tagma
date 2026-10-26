import * as Effect from 'effect/Effect';
import type { StoredVitalRecord } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta } from '../protocol/reports.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer } from './answer.js';
import { timePage } from './page.js';
import { readRecord } from './record.js';

export const readVitals = Effect.fn('PerformanceWorker.readVitals')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'vitals' }>,
  meta: PerformanceReportMeta,
) {
  const page = yield* timePage(readers, 'vital', query);
  const vitals: StoredVitalRecord[] = [];
  for (const row of page.rows) {
    const record = yield* readRecord(row);
    if (record.kind !== 'vital') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    vitals.push(record);
  }
  return { _tag: 'Found', report: { type: 'vitals', ...meta, vitals, next: page.next } } satisfies ReportAnswer;
});
