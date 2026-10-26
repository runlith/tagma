import type { LossKindCounts, ThreadMemory } from '../protocol/records.js';
import type { PerformancePointQuery, PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta } from '../protocol/reports.js';
import type { WorkerReport } from './records.js';

export type InitializeStore = {
  readonly _tag: 'InitializeStore';
  readonly path: string;
  readonly instanceId: string;
  readonly maxStoredBytes: number;
  readonly busyTimeoutMs?: number | undefined;
  readonly maxReportSamples?: number | undefined;
  readonly watch?: boolean | undefined;
};

export type WriteRecords = {
  readonly _tag: 'WriteRecords';
  readonly sequence: number;
  readonly records: ArrayBuffer;
  readonly droppedKinds: LossKindCounts;
  readonly maxStoredBytes: number;
  readonly protectedRetentionKeys: ReadonlyArray<string>;
};

export type RecordDrops = {
  readonly _tag: 'RecordDrops';
  readonly sequence: number;
  readonly droppedKinds: LossKindCounts;
};

export type MaintainStore = {
  readonly _tag: 'MaintainStore';
  readonly sequence: number;
  readonly maxStoredBytes: number;
  readonly protectedRetentionKeys: ReadonlyArray<string>;
};

export type ReadReport = {
  readonly _tag: 'ReadReport';
  readonly requestId: string;
  readonly query: PerformanceQuery;
};

export type WorkerMemoryReading = {
  readonly reading: ThreadMemory;
  readonly collected?: { readonly pauseMs: number; readonly reading: ThreadMemory };
};

export type ReadWorkerMemory = {
  readonly _tag: 'ReadWorkerMemory';
  readonly requestId: string;
  readonly collect: boolean;
};

export type StoreRequest = InitializeStore | WriteRecords | RecordDrops | MaintainStore | ReadReport | ReadWorkerMemory;

export type StoreAnswer =
  | {
      readonly _tag: 'StoreReady';
      readonly dropCount: number;
      readonly droppedKinds: LossKindCounts;
    }
  | {
      readonly _tag: 'RecordsAck';
      readonly sequence: number;
    }
  | {
      readonly _tag: 'CommandDone';
      readonly sequence: number;
    }
  | {
      readonly _tag: 'StoreMaintained';
      readonly sequence: number;
      readonly evicted: number;
      readonly records: number;
      readonly droppedKinds: LossKindCounts;
      readonly elapsedMs: number;
    }
  | { readonly _tag: 'ReportDone'; readonly requestId: string; readonly report: WorkerReport }
  | { readonly _tag: 'WorkerMemoryDone'; readonly requestId: string; readonly reading: WorkerMemoryReading }
  | {
      readonly _tag: 'ReportNotFound';
      readonly requestId: string;
      readonly query: PerformancePointQuery;
      readonly meta: PerformanceReportMeta;
    }
  | { readonly _tag: 'ReportFailed'; readonly requestId: string; readonly message: string }
  | { readonly _tag: 'StoreUnavailable'; readonly message: string };
