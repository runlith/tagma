import * as Data from 'effect/Data';
import type { WorkerReport } from '../store/records.js';
import type { PerformancePointQuery } from '../protocol/queries.js';
import type { SegmentReader } from '../SegmentRing.js';
import { performanceRecord } from '../schema.js';

export class PerformanceRecordUnreadable extends Data.TaggedError('PerformanceRecordUnreadable')<{
  readonly recordId: string;
}> {
  override get message(): string {
    return `performance record ${this.recordId} is corrupt`;
  }
}

export type ReportAnswer =
  | { readonly _tag: 'Found'; readonly report: WorkerReport }
  | { readonly _tag: 'NotFound'; readonly query: PerformancePointQuery };

export type Row = typeof performanceRecord.$inferSelect;

export type Readers = ReadonlyArray<SegmentReader>;
