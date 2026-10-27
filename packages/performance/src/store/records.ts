import * as Data from 'effect/Data';
import type { LossKindCounts, PerformanceRecordKind, StoreState } from '../protocol/records.js';
import type { PerformancePointQuery } from '../protocol/queries.js';
import type { PerformanceReport, PerformanceReportMeta } from '../protocol/reports.js';

export type JsonValue = string | number | boolean | null | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue };

export type PerformanceRecord<Kind extends PerformanceRecordKind = PerformanceRecordKind, Payload extends JsonValue = JsonValue> = {
  readonly id: string;
  readonly kind: Kind;
  readonly instanceId: string;
  readonly wallTime: number;
  readonly monotonicStart: number;
  readonly monotonicEnd: number;
  readonly traceId?: string | undefined;
  readonly parentId?: string | null | undefined;
  readonly name?: string | undefined;
  readonly payload: Payload;
};

let measured: PerformanceRecord | undefined;
let measuredJson = '';

export function recordByteSize(record: PerformanceRecord): number {
  const json = JSON.stringify(record);
  measured = record;
  measuredJson = json;
  return Buffer.byteLength(json);
}

const recordJson = (record: PerformanceRecord): string => {
  if (record !== measured) return JSON.stringify(record);
  const json = measuredJson;
  measured = undefined;
  measuredJson = '';
  return json;
};

export const recordLine = (record: PerformanceRecord, retentionKey: string): string =>
  `[${recordJson(record)},${JSON.stringify(retentionKey)}]`;

export type PerformanceSubmission = {
  readonly record: PerformanceRecord;
  readonly retentionKey: string;
  readonly byteSize: number;
};

export type PerformanceLossAccount = {
  readonly reason: PerformanceRecordNotKeptReason;
  readonly kinds: LossKindCounts;
  readonly from: number;
  readonly to: number;
};

export type PerformanceStoreDiagnostics = {
  readonly state: StoreState;
  readonly path: string;
  readonly restarts: number;
  readonly activeGroups: number;
  readonly pendingBytes: number;
  readonly pendingRecords: number;
  readonly peakPendingBytes: number;
  readonly dropCount: number;
  readonly maintenancePasses: number;
  readonly evictedSegments: number;
  readonly lastEvictionMs: number | null;
  readonly uncertainRecords: number;
  readonly unrecorded: ReadonlyArray<PerformanceLossAccount>;
  readonly lastError: string | null;
};

export type PerformanceStoreOptions = {
  readonly path: string;
  readonly instanceId: string;
  readonly maxPendingBytes: () => number;
  readonly maxStoredBytes: () => number;
  readonly commandTimeoutMs?: number | undefined;
  readonly openTimeoutMs?: number | undefined;
  readonly busyTimeoutMs?: number | undefined;
  readonly reportTimeoutMs?: number | undefined;
  readonly maxReportSamples?: number | undefined;
  readonly flushIntervalMs?: number | undefined;
  readonly maintainIntervalMs?: number | undefined;
};

export class PerformanceStoreUnavailable extends Data.TaggedError('PerformanceStoreUnavailable')<{
  readonly message: string;
  readonly cause?: import('@runlith/utils/worker').WorkerUnavailable;
}> {}

export class PerformanceStoreQueryFailed extends Data.TaggedError('PerformanceStoreQueryFailed')<{
  readonly message: string;
}> {}

export class PerformanceReportUnavailable extends Data.TaggedError('PerformanceReportUnavailable')<{
  readonly reason: 'timeout';
  readonly message: string;
}> {}

export type PerformanceRecordNotKeptReason = 'pending-limit' | 'store-unavailable';

export class PerformanceRecordRefused extends Data.TaggedError('PerformanceRecordRefused')<{
  readonly reason: 'pending-limit';
  readonly message: string;
}> {}

export class PerformanceRecordUnavailable extends Data.TaggedError('PerformanceRecordUnavailable')<{
  readonly reason: 'store-unavailable';
  readonly message: string;
}> {}

export type PerformanceRecordFailure = PerformanceRecordRefused | PerformanceRecordUnavailable;

export type PerformanceStoreFailure = PerformanceStoreUnavailable | PerformanceStoreQueryFailed | PerformanceReportUnavailable;

export type WorkerLossesPage = Omit<Extract<PerformanceReport, { readonly type: 'losses' }>, 'pressure' | 'unrecorded' | 'evidence'>;
export type WorkerReport = Exclude<PerformanceReport, { readonly type: 'losses' }> | WorkerLossesPage;

export type StoreReportRead =
  | { readonly _tag: 'Found'; readonly report: PerformanceReport }
  | { readonly _tag: 'NotFound'; readonly query: PerformancePointQuery; readonly meta: PerformanceReportMeta };

export type WorkerReportRead =
  | { readonly _tag: 'WorkerFound'; readonly report: WorkerReport }
  | { readonly _tag: 'NotFound'; readonly query: PerformancePointQuery; readonly meta: PerformanceReportMeta };
