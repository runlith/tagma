import * as Schema from 'effect/Schema';
import { ExecutionRef, ProcessCost } from '@runlith/executions/protocol/execution';
import { CommandClass, CommandExit } from '@runlith/executions/protocol/command';
import { EvidenceCompleteness, UsageMemory, UsageRate } from '@runlith/executions/protocol/evidence';
import { cpuProfilePayloadSchema, cpuProfileReadPayloadSchema } from '../CpuProfile.js';

const nonEmptyString = Schema.String.check(Schema.isMinLength(1));
const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const nonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const PERFORMANCE_RECORD_KINDS = ['span', 'stall', 'vital', 'metric', 'profile', 'memory', 'loss', 'command', 'load'] as const;

export type PerformanceRecordKind = (typeof PERFORMANCE_RECORD_KINDS)[number];

export const performanceRecordKindSchema = Schema.Literals(PERFORMANCE_RECORD_KINDS);

export const processCpuSchema = Schema.Struct({
  userMicros: Schema.Number,
  systemMicros: Schema.Number,
});
export type ProcessCpu = typeof processCpuSchema.Type;

export const processMemorySchema = Schema.Struct({
  rssBytes: Schema.Number,
  heapTotalBytes: Schema.Number,
  heapUsedBytes: Schema.Number,
  externalBytes: Schema.Number,
  arrayBufferBytes: Schema.Number,
  allocator: Schema.optional(
    Schema.Struct({
      rssBytes: nonNegativeNumber,
      rssPeakBytes: nonNegativeNumber,
      committedBytes: nonNegativeNumber,
      committedPeakBytes: nonNegativeNumber,
      pageFaults: nonNegativeNumber,
    }),
  ),
});
export type ProcessMemory = typeof processMemorySchema.Type;

export const spanPayloadSchema = Schema.Struct({
  spanKind: Schema.Literals(['internal', 'server', 'client', 'producer', 'consumer']),
  exit: Schema.Union([
    Schema.Struct({ _tag: Schema.tag('Success') }),
    Schema.Struct({
      _tag: Schema.tag('Failure'),
      reasons: Schema.Array(Schema.Literals(['Fail', 'Die', 'Interrupt'])),
    }),
  ]),
  attributes: Schema.Record(Schema.String, Schema.Json),
});
export type SpanPayload = typeof spanPayloadSchema.Type;

export const stallPayloadSchema = Schema.Struct({
  delayMs: Schema.Number,
  cpu: processCpuSchema,
  loopCpu: Schema.optional(processCpuSchema),
  cpuWindowMs: Schema.optional(nonNegativeNumber),
  memory: processMemorySchema,
  profileId: Schema.optional(Schema.String),
});
export type StallPayload = typeof stallPayloadSchema.Type;

export const stallCauseSchema = Schema.Literals(['cpu', 'cpu-or-gc', 'blocked']);
export type StallCause = typeof stallCauseSchema.Type;

export function stallCause(payload: StallPayload): StallCause {
  const windowMs = Math.max(0, payload.cpuWindowMs ?? payload.delayMs);
  const loopCpu = payload.loopCpu;
  if (loopCpu !== undefined) {
    const loopCpuMs = (loopCpu.userMicros + loopCpu.systemMicros) / 1_000;
    return loopCpuMs >= windowMs / 2 ? 'cpu' : 'blocked';
  }
  const processCpuMs = (payload.cpu.userMicros + payload.cpu.systemMicros) / 1_000;
  return processCpuMs >= windowMs / 2 ? 'cpu-or-gc' : 'blocked';
}

export const storeStateSchema = Schema.Literals(['starting', 'ready', 'unavailable']);
export type StoreState = typeof storeStateSchema.Type;

export const storePressureSchema = Schema.Struct({
  state: storeStateSchema,
  pendingRecords: nonNegativeInt,
  pendingBytes: nonNegativeInt,
  peakPendingBytes: nonNegativeInt,
  persistedRecords: nonNegativeInt,
  droppedRecords: nonNegativeInt,
});
export type StorePressure = typeof storePressureSchema.Type;

export const vitalPayloadSchema = Schema.Struct({
  cpu: processCpuSchema,
  memory: processMemorySchema,
  loopDelay: Schema.Struct({
    count: Schema.Number,
    p50Ms: Schema.Number,
    p99Ms: Schema.Number,
    maxMs: Schema.Number,
  }),
  store: Schema.optional(storePressureSchema),
});
export type VitalPayload = typeof vitalPayloadSchema.Type;

export const lossKindCountsSchema = Schema.Record(performanceRecordKindSchema, Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))));
export type LossKindCounts = typeof lossKindCountsSchema.Type;

export const commandPayloadSchema = Schema.Struct({
  class: CommandClass,
  substrate: Schema.Literals(['managed', 'platform']),
  cost: ProcessCost,
  exit: CommandExit,
  threadId: Schema.optional(nonEmptyString),
  projectId: Schema.optional(nonNegativeInt),
  check: Schema.optional(nonEmptyString),
});
export type CommandPayload = typeof commandPayloadSchema.Type;

const loadReadingFields = {
  takenAtMicros: nonNegativeInt,
  completeness: EvidenceCompleteness,
} as const;

const treeLoadFields = {
  ...loadReadingFields,
  cpuMicros: nonNegativeNumber,
  cpu: UsageRate,
  memory: UsageMemory,
  processes: nonNegativeInt,
} as const;

const executionSubjectFields = {
  _tag: Schema.tag('Execution'),
  execution: ExecutionRef,
  threadId: Schema.optional(nonEmptyString),
  projectId: Schema.optional(nonNegativeInt),
} as const;

const installationSubjectFields = { _tag: Schema.tag('Installation') } as const;

const machineSubjectFields = {
  _tag: Schema.tag('Machine'),
  cores: Schema.Int.check(Schema.isGreaterThan(0)),
} as const;

export const loadSubjectSchema = Schema.Union([
  Schema.Struct(executionSubjectFields),
  Schema.Struct(installationSubjectFields),
  Schema.Struct(machineSubjectFields),
]).pipe(Schema.toTaggedUnion('_tag'));
export type LoadSubject = typeof loadSubjectSchema.Type;

export const LOAD_SUBJECTS = ['Execution', 'Installation', 'Machine'] as const;
export const loadSubjectKindSchema = Schema.Literals(LOAD_SUBJECTS);
export type LoadSubjectKind = typeof loadSubjectKindSchema.Type;

export const loadPayloadSchema = Schema.Union([
  Schema.Struct({ ...executionSubjectFields, ...treeLoadFields }),
  Schema.Struct({ ...installationSubjectFields, ...treeLoadFields }),
  Schema.Struct({
    ...machineSubjectFields,
    busy: UsageRate,
    ...loadReadingFields,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type LoadPayload = typeof loadPayloadSchema.Type;

export const lossPayloadSchema = Schema.Struct({
  reason: Schema.Literals(['pending-limit', 'stored-limit']),
  kinds: lossKindCountsSchema,
  peakPendingBytes: Schema.optional(nonNegativeInt),
  range: Schema.optional(Schema.Struct({ from: nonNegativeInt, to: nonNegativeInt })),
});
export type LossPayload = typeof lossPayloadSchema.Type;

export const threadMemorySchema = Schema.Struct({
  thread: nonEmptyString,
  censusMs: nonNegativeNumber,
  process: processMemorySchema,
  heap: Schema.Struct({
    sizeBytes: nonNegativeNumber,
    capacityBytes: nonNegativeNumber,
    extraMemoryBytes: nonNegativeNumber,
    objectCount: nonNegativeNumber,
    protectedObjectCount: nonNegativeNumber,
  }),
  allocator: Schema.optional(
    Schema.Struct({
      reservedBytes: nonNegativeNumber,
      committedBytes: nonNegativeNumber,
      committedPeakBytes: nonNegativeNumber,
      rssBytes: nonNegativeNumber,
      rssPeakBytes: nonNegativeNumber,
      purgedBytes: nonNegativeNumber,
      abandonedPages: nonNegativeNumber,
      pageFaults: nonNegativeNumber,
    }),
  ),
  largestTypes: Schema.Array(Schema.Struct({ name: nonEmptyString, count: nonNegativeNumber })),
});
export type ThreadMemory = typeof threadMemorySchema.Type;

export const memoryPayloadSchema = Schema.Struct({
  requestedBy: nonEmptyString,
  threads: Schema.Array(threadMemorySchema),
  collected: Schema.optional(Schema.Struct({ pauseMs: nonNegativeNumber, threads: Schema.Array(threadMemorySchema) })),
});
export type MemoryPayload = typeof memoryPayloadSchema.Type;

export const memoryCaptureRequestSchema = Schema.Struct({
  requestedBy: nonEmptyString,
  collect: Schema.optional(Schema.Boolean),
});
export type MemoryCaptureRequest = typeof memoryCaptureRequestSchema.Type;

export const metricSamplePayloadSchema = Schema.Struct({
  boundariesMs: Schema.Array(Schema.Number),
  bucketCounts: Schema.Array(Schema.Number),
  count: Schema.Number,
  failures: Schema.Number,
  sumMs: Schema.Number,
  minMs: Schema.Number,
  maxMs: Schema.Number,
}).pipe(
  Schema.check(
    Schema.makeFilter((sample) => {
      if (
        sample.boundariesMs.length === 0 ||
        sample.boundariesMs.some(
          (boundary, index) => !Number.isFinite(boundary) || boundary < 0 || (index > 0 && boundary <= sample.boundariesMs[index - 1]!),
        )
      ) {
        return 'Metric boundaries must be finite, non-negative, non-empty and strictly increasing.';
      }
      if (
        sample.bucketCounts.length !== sample.boundariesMs.length + 1 ||
        sample.bucketCounts.some((count) => !Number.isInteger(count) || count < 0)
      ) {
        return 'Metric buckets must be non-negative integer counts with one overflow bucket.';
      }
      if (
        !Number.isInteger(sample.count) ||
        sample.count < 0 ||
        sample.bucketCounts.reduce((total, count) => total + count, 0) !== sample.count
      ) {
        return 'Metric count must equal the sum of its buckets.';
      }
      if (!Number.isInteger(sample.failures) || sample.failures < 0 || sample.failures > sample.count) {
        return 'Metric failures must be a non-negative integer no greater than count.';
      }
      if (
        !Number.isFinite(sample.sumMs) ||
        !Number.isFinite(sample.minMs) ||
        !Number.isFinite(sample.maxMs) ||
        sample.sumMs < 0 ||
        sample.minMs < 0 ||
        sample.maxMs < sample.minMs
      ) {
        return 'Metric summary values must be finite, non-negative and ordered.';
      }
      return undefined;
    }),
  ),
);
export type MetricSamplePayload = typeof metricSamplePayloadSchema.Type;

export const recordFields = {
  id: nonEmptyString,
  instanceId: nonEmptyString,
  wallTime: nonNegativeInt,
  monotonicStart: Schema.Number,
  monotonicEnd: Schema.Number,
} as const;

export const spanRecordSchema = Schema.Struct({
  ...recordFields,
  kind: Schema.tag('span'),
  traceId: nonEmptyString,
  parentId: Schema.NullOr(nonEmptyString),
  name: nonEmptyString,
  payload: spanPayloadSchema,
});
export type StoredSpanRecord = typeof spanRecordSchema.Type;

export const spanTimingSchema = Schema.Struct({
  ...recordFields,
  monotonicStart: Schema.Number.check(Schema.isFinite()),
  monotonicEnd: Schema.Number.check(Schema.isFinite()),
  traceId: nonEmptyString,
  parentId: Schema.NullOr(nonEmptyString),
  name: nonEmptyString,
  durationMs: nonNegativeNumber.check(Schema.isFinite()),
}).check(
  Schema.makeFilter((span) =>
    span.monotonicEnd >= span.monotonicStart && span.durationMs === span.monotonicEnd - span.monotonicStart
      ? undefined
      : 'Span timing must carry an ordered interval and its elapsed duration.',
  ),
);
export type SpanTiming = typeof spanTimingSchema.Type;
export const stallRecordSchema = Schema.Struct({ ...recordFields, kind: Schema.tag('stall'), payload: stallPayloadSchema });
export type StoredStallRecord = typeof stallRecordSchema.Type;
export const vitalRecordSchema = Schema.Struct({ ...recordFields, kind: Schema.tag('vital'), payload: vitalPayloadSchema });
export type StoredVitalRecord = typeof vitalRecordSchema.Type;
export const metricRecordSchema = Schema.Struct({
  ...recordFields,
  kind: Schema.tag('metric'),
  name: nonEmptyString,
  payload: metricSamplePayloadSchema,
});
export type StoredMetricRecord = typeof metricRecordSchema.Type;
export const memoryRecordSchema = Schema.Struct({
  ...recordFields,
  kind: Schema.tag('memory'),
  payload: memoryPayloadSchema,
});
export type StoredMemoryRecord = typeof memoryRecordSchema.Type;
export const profileRecordSchema = Schema.Struct({
  ...recordFields,
  kind: Schema.tag('profile'),
  payload: cpuProfilePayloadSchema,
});
export type StoredProfileRecord = typeof profileRecordSchema.Type;
export const lossRecordSchema = Schema.Struct({ ...recordFields, kind: Schema.tag('loss'), payload: lossPayloadSchema });
export type StoredLossRecord = typeof lossRecordSchema.Type;
export const commandRecordSchema = Schema.Struct({
  ...recordFields,
  kind: Schema.tag('command'),
  payload: commandPayloadSchema,
});
export type StoredCommandRecord = typeof commandRecordSchema.Type;
export const loadRecordSchema = Schema.Struct({
  ...recordFields,
  kind: Schema.tag('load'),
  payload: loadPayloadSchema,
});
export type StoredLoadRecord = typeof loadRecordSchema.Type;

export const profileReadRecordSchema = Schema.Struct({
  ...recordFields,
  kind: Schema.tag('profile'),
  payload: cpuProfileReadPayloadSchema,
});
export type ProfileReadRecord = typeof profileReadRecordSchema.Type;

export const performanceRecordSchema = Schema.Union([
  spanRecordSchema,
  stallRecordSchema,
  vitalRecordSchema,
  metricRecordSchema,
  memoryRecordSchema,
  profileRecordSchema,
  lossRecordSchema,
  commandRecordSchema,
  loadRecordSchema,
]).pipe(
  Schema.toTaggedUnion('kind'),
  Schema.check(
    Schema.makeFilter((record) =>
      record.monotonicEnd >= record.monotonicStart
        ? undefined
        : 'Performance record monotonicEnd must be greater than or equal to monotonicStart.',
    ),
  ),
);
export type StoredPerformanceRecord = typeof performanceRecordSchema.Type;
