import * as Schema from 'effect/Schema';
export const metricPercentileSchema = Schema.Union([
  Schema.Struct({ upperBoundMs: Schema.Number }),
  Schema.Struct({ aboveMs: Schema.Number }),
]);
export type MetricPercentile = typeof metricPercentileSchema.Type;
import { CommandClass } from '@runlith/executions/protocol/command';
import { cpuProfileFrameSchema, stallSamplingSchema, storedProfileRequestSchema } from '../CpuProfile.js';
import { costPageSchema, type CostPage } from '../CostLedger.js';
import {
  breakdownCursorSchema,
  metricCursorSchema,
  namesCursorSchema,
  overviewCursorSchema,
  slowCursorSchema,
  timeCursorSchema,
  traceCursorSchema,
} from './queries.js';
import {
  commandRecordSchema,
  loadSubjectSchema,
  lossKindCountsSchema,
  lossRecordSchema,
  memoryRecordSchema,
  profileReadRecordSchema,
  recordFields,
  spanRecordSchema,
  spanTimingSchema,
  stallCauseSchema,
  stallRecordSchema,
  storePressureSchema,
  threadMemorySchema,
  vitalRecordSchema,
} from './records.js';

const nonEmptyString = Schema.String.check(Schema.isMinLength(1));
const positiveLimit = Schema.Int.check(Schema.isGreaterThan(0));
const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const nonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const retainedRangeSchema = Schema.NullOr(Schema.Struct({ from: nonNegativeInt, to: nonNegativeInt }));
export type RetainedRange = typeof retainedRangeSchema.Type;
const reportMetaFields = {
  inheritedDrops: Schema.NullOr(nonNegativeInt),
  sessionDrops: nonNegativeInt,
  inheritedDroppedKinds: Schema.NullOr(lossKindCountsSchema),
  sessionDroppedKinds: lossKindCountsSchema,
  retainedRange: retainedRangeSchema,
} as const;
export const performanceReportMetaSchema = Schema.Struct(reportMetaFields);
export type PerformanceReportMeta = typeof performanceReportMetaSchema.Type;

export const traceSegmentSchema = Schema.Struct({
  instanceId: nonEmptyString,
  spans: Schema.Array(spanRecordSchema),
  rootIds: Schema.Array(nonEmptyString),
});
export type TraceSegment = typeof traceSegmentSchema.Type;
export const profileSummarySchema = Schema.Struct({
  ...recordFields,
  ...storedProfileRequestSchema.fields,
});
export type ProfileSummary = typeof profileSummarySchema.Type;

export const metricHourSchema = Schema.Struct({
  hourStart: nonNegativeInt,
  boundaryKey: nonEmptyString,
  boundariesMs: Schema.Array(Schema.Number),
  bucketCounts: Schema.Array(Schema.Number),
  count: Schema.Number,
  failures: Schema.Number,
  sumMs: Schema.Number,
  p50: metricPercentileSchema,
  p99: metricPercentileSchema,
  partial: Schema.Boolean,
});
export type MetricHour = typeof metricHourSchema.Type;

export const overviewPartialReasonSchema = Schema.Literals([
  'missing-baseline',
  'reset',
  'boundary-change',
  'clipped-since',
  'clipped-until',
]);
export type OverviewPartialReason = typeof overviewPartialReasonSchema.Type;

export const overviewSeriesSchema = Schema.Struct({
  name: nonEmptyString,
  boundaryKey: nonEmptyString,
  boundariesMs: Schema.Array(Schema.Number),
  bucketCounts: Schema.Array(Schema.Number),
  count: Schema.Number,
  failures: Schema.Number,
  sumMs: Schema.Number,
  p50: Schema.optional(metricPercentileSchema),
  p99: Schema.optional(metricPercentileSchema),
  partial: Schema.Boolean,
  reasons: Schema.Array(overviewPartialReasonSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter((series) => (series.partial === series.reasons.length > 0 ? undefined : 'Overview partial must match its reasons.')),
  ),
);
export type OverviewSeries = typeof overviewSeriesSchema.Type;

export const memoryReportSchema = Schema.Struct({
  type: Schema.tag('memory'),
  ...reportMetaFields,
  threads: Schema.Array(threadMemorySchema),
  store: Schema.Struct({
    pendingBytes: nonNegativeNumber,
    pendingRecords: nonNegativeNumber,
  }),
  database: Schema.Struct({
    path: nonEmptyString,
    fileBytes: nonNegativeNumber,
    pageBytes: nonNegativeNumber,
    pageCount: nonNegativeNumber,
    freePages: nonNegativeNumber,
    cacheBytes: nonNegativeNumber,
    mmapBytes: nonNegativeNumber,
    logBytes: nonNegativeNumber,
  }),
});

export const capturesReportSchema = Schema.Struct({
  type: Schema.tag('captures'),
  ...reportMetaFields,
  captures: Schema.Array(memoryRecordSchema),
  next: Schema.NullOr(timeCursorSchema),
});

export const memoryGrowthThreadSchema = Schema.Struct({
  thread: nonEmptyString,
  rssDeltaBytes: Schema.Number,
  heapUsedDeltaBytes: Schema.Number,
  heapSizeDeltaBytes: Schema.Number,
  objectCountDelta: Schema.Number,
  committedDeltaBytes: Schema.optional(Schema.Number),
  types: Schema.Array(
    Schema.Struct({
      name: nonEmptyString,
      before: nonNegativeNumber,
      after: nonNegativeNumber,
      delta: Schema.Number,
    }),
  ),
});
export type MemoryGrowthThread = typeof memoryGrowthThreadSchema.Type;

export const growthReportSchema = Schema.Struct({
  type: Schema.tag('growth'),
  ...reportMetaFields,
  from: memoryRecordSchema,
  to: memoryRecordSchema,
  elapsedMs: nonNegativeNumber,
  threads: Schema.Array(memoryGrowthThreadSchema),
});

export const namesReportSchema = Schema.Struct({
  type: Schema.tag('names'),
  ...reportMetaFields,
  spanNames: Schema.Array(nonEmptyString),
  metricNames: Schema.Array(nonEmptyString),
  evidence: Schema.Literal('retained-only'),
  next: Schema.NullOr(namesCursorSchema),
});
export const stallOverlapSchema = Schema.Struct({
  name: nonEmptyString,
  count: nonNegativeInt,
  totalMs: nonNegativeNumber,
  maxMs: nonNegativeNumber,
});
export type StallOverlap = typeof stallOverlapSchema.Type;
export const stallCallerSchema = Schema.Struct({
  name: nonEmptyString,
  runId: nonEmptyString,
  threadId: Schema.optional(Schema.String),
  toolName: Schema.optional(Schema.String),
  toolCallId: Schema.optional(Schema.String),
  coveredMs: nonNegativeNumber,
  durationMs: nonNegativeNumber,
});
export type StallCaller = typeof stallCallerSchema.Type;

export const stallReadingSchema = Schema.Struct({
  stall: stallRecordSchema,
  cause: stallCauseSchema,
  sampling: Schema.NullOr(stallSamplingSchema),
  caller: Schema.NullOr(stallCallerSchema),
});
export type StallReading = typeof stallReadingSchema.Type;
export const stallsReportSchema = Schema.Struct({
  type: Schema.tag('stalls'),
  ...reportMetaFields,
  stalls: Schema.Array(stallReadingSchema),
  next: Schema.NullOr(timeCursorSchema),
});
export const stallReportSchema = Schema.Struct({
  type: Schema.tag('stall'),
  ...reportMetaFields,
  stall: stallRecordSchema,
  cause: stallCauseSchema,
  sampling: Schema.NullOr(stallSamplingSchema),
  callers: Schema.Array(stallCallerSchema),
  overlap: Schema.Array(stallOverlapSchema),
  spans: Schema.Array(spanRecordSchema),
  vitals: Schema.Array(vitalRecordSchema),
  next: Schema.NullOr(timeCursorSchema),
});
export const slowReportSchema = Schema.Struct({
  type: Schema.tag('slow'),
  ...reportMetaFields,
  total: Schema.NullOr(nonNegativeInt),
  spans: Schema.Array(spanRecordSchema),
  next: Schema.NullOr(slowCursorSchema),
});
export const traceReportSchema = Schema.Struct({
  type: Schema.tag('trace'),
  ...reportMetaFields,
  traceId: nonEmptyString,
  segments: Schema.Array(traceSegmentSchema),
  totalSpans: nonNegativeInt,
  next: Schema.NullOr(traceCursorSchema),
});
export const breakdownReportSchema = Schema.Struct({
  type: Schema.tag('breakdown'),
  ...reportMetaFields,
  span: spanTimingSchema,
  coveredMs: nonNegativeNumber.check(Schema.isFinite()),
  selfMs: nonNegativeNumber.check(Schema.isFinite()),
  totalChildren: nonNegativeInt,
  evidence: Schema.Literal('retained-only'),
  children: Schema.Array(
    Schema.Struct({
      ...spanTimingSchema.fields,
      coveredMs: nonNegativeNumber.check(Schema.isFinite()),
    }),
  ),
  next: Schema.NullOr(breakdownCursorSchema),
});

export const vitalsReportSchema = Schema.Struct({
  type: Schema.tag('vitals'),
  ...reportMetaFields,
  vitals: Schema.Array(vitalRecordSchema),
  next: Schema.NullOr(timeCursorSchema),
});
export const lossAccountSchema = Schema.Struct({
  reason: Schema.Literals(['pending-limit', 'store-unavailable']),
  kinds: lossKindCountsSchema,
  from: nonNegativeInt,
  to: nonNegativeInt,
});
export type LossAccount = typeof lossAccountSchema.Type;

export const lossesReportSchema = Schema.Struct({
  type: Schema.tag('losses'),
  ...reportMetaFields,
  losses: Schema.Array(lossRecordSchema),
  next: Schema.NullOr(timeCursorSchema),
  pressure: storePressureSchema,
  unrecorded: Schema.Array(lossAccountSchema),
  evidence: Schema.Union([
    Schema.Struct({ _tag: Schema.tag('retained-and-live') }),
    Schema.Struct({ _tag: Schema.tag('process-memory'), reason: nonEmptyString }),
  ]),
});

export const commandClassReadingSchema = Schema.Struct({
  class: CommandClass,
  count: nonNegativeInt,
  failures: nonNegativeInt,
  wallMs: nonNegativeNumber,
  maxWallMs: nonNegativeNumber,
  cpuMicros: nonNegativeNumber,
  maxPeakRssBytes: nonNegativeNumber,
  unmeasured: nonNegativeInt,
});
export type CommandClassReading = typeof commandClassReadingSchema.Type;

export const commandsReportSchema = Schema.Struct({
  type: Schema.tag('commands'),
  ...reportMetaFields,
  classes: Schema.Array(commandClassReadingSchema),
  commands: Schema.Array(commandRecordSchema),
  evidence: Schema.Literal('retained-only'),
  next: Schema.NullOr(timeCursorSchema),
});
export const loadBucketSchema = Schema.Struct({
  startedAt: nonNegativeInt,
  readings: Schema.Int.check(Schema.isGreaterThan(0)),
  maxCores: Schema.NullOr(nonNegativeNumber),
  meanCores: Schema.NullOr(nonNegativeNumber),
  unmeasuredCpu: nonNegativeInt,
  maxResidentBytes: Schema.NullOr(nonNegativeNumber),
  unmeasuredMemory: nonNegativeInt,
  cpuSeconds: Schema.NullOr(nonNegativeNumber),
}).pipe(
  Schema.check(
    Schema.makeFilter((bucket) => {
      if ((bucket.maxCores === null) !== (bucket.unmeasuredCpu === bucket.readings)) {
        return 'A load bucket answers cores exactly when some reading of it measured a rate.';
      }
      if ((bucket.maxResidentBytes === null) !== (bucket.unmeasuredMemory === bucket.readings)) {
        return 'A load bucket answers resident bytes exactly when some reading of it measured memory.';
      }
      if ((bucket.meanCores === null) !== (bucket.maxCores === null)) {
        return 'A load bucket carries its mean exactly when it carries its maximum.';
      }
      return bucket.meanCores === null || bucket.maxCores === null || bucket.meanCores <= bucket.maxCores
        ? undefined
        : 'A load bucket mean cannot exceed its maximum.';
    }),
  ),
);
export type LoadBucket = typeof loadBucketSchema.Type;

export const loadSeriesSchema = Schema.Struct({
  subject: loadSubjectSchema,
  readings: nonNegativeInt,
  cpuSeconds: Schema.NullOr(nonNegativeNumber),
  maxCores: Schema.NullOr(nonNegativeNumber),
  counterBreaks: nonNegativeInt,
  buckets: Schema.Array(loadBucketSchema),
});
export type LoadSeries = typeof loadSeriesSchema.Type;

export const loadReportSchema = Schema.Struct({
  type: Schema.tag('load'),
  ...reportMetaFields,
  stepMs: positiveLimit,
  subjects: Schema.Array(loadSeriesSchema),
  evidence: Schema.Literal('retained-only'),
  next: Schema.NullOr(timeCursorSchema),
});
export const metricsReportSchema = Schema.Struct({
  type: Schema.tag('metrics'),
  ...reportMetaFields,
  hours: Schema.Array(metricHourSchema),
  next: Schema.NullOr(metricCursorSchema),
});
export const overviewReportSchema = Schema.Struct({
  type: Schema.tag('overview'),
  ...reportMetaFields,
  total: Schema.NullOr(nonNegativeInt),
  since: nonNegativeInt,
  until: nonNegativeInt,
  observed: retainedRangeSchema,
  coverageReason: Schema.NullOr(Schema.Literal('no-snapshots-in-interval')),
  samplesRead: nonNegativeInt,
  series: Schema.Array(overviewSeriesSchema),
  stoppedAtBudget: Schema.Boolean,
  next: Schema.NullOr(overviewCursorSchema),
});
export const profilesReportSchema = Schema.Struct({
  type: Schema.tag('profiles'),
  ...reportMetaFields,
  profiles: Schema.Array(profileSummarySchema),
  next: Schema.NullOr(timeCursorSchema),
});
export const profileReportSchema = Schema.Struct({
  type: Schema.tag('profile'),
  ...reportMetaFields,
  profile: profileReadRecordSchema,
  frames: Schema.Array(cpuProfileFrameSchema),
});

const ledgerReportSchema = Schema.Struct({
  type: Schema.tag('ledger'),
  ...costPageSchema.fields,
});
export interface LedgerReport extends CostPage {
  readonly type: 'ledger';
}

const writerCursorSchema = Schema.Struct({ writerId: nonEmptyString, sequence: nonNegativeInt });
const writerUnitSchema = Schema.Struct({
  sequence: nonNegativeInt,
  rootId: Schema.NullOr(nonEmptyString),
  operation: nonEmptyString,
  store: Schema.String,
  outcome: Schema.Literals(['success', 'failure', 'interrupted']),
  acquired: Schema.Boolean,
  waitMs: Schema.Number,
  holdMs: Schema.Number,
  childMs: Schema.NullOr(Schema.Number),
  outsideMs: Schema.NullOr(Schema.Number),
  commitReturnedAt: Schema.NullOr(Schema.Number),
  writerPid: Schema.NullOr(nonNegativeInt),
});
const writerHistogramSchema = Schema.Struct({
  count: nonNegativeInt,
  sumMs: Schema.Number,
  bucketCounts: Schema.Array(nonNegativeInt),
  p50: Schema.NullOr(metricPercentileSchema),
  p99: Schema.NullOr(metricPercentileSchema),
});
const writerOperationSchema = Schema.Struct({
  operation: nonEmptyString,
  series: nonNegativeInt,
  sinceSequence: nonNegativeInt,
  latestSequence: nonNegativeInt,
  count: nonNegativeInt,
  failures: nonNegativeInt,
  interruptions: nonNegativeInt,
  incomplete: nonNegativeInt,
  wait: writerHistogramSchema,
  hold: writerHistogramSchema,
  child: writerHistogramSchema,
  outside: writerHistogramSchema,
});
const writerUnitsReportSchema = Schema.Struct({
  type: Schema.tag('writer-units'),
  writerId: nonEmptyString,
  reset: Schema.Boolean,
  gap: Schema.Boolean,
  oldestSequence: nonNegativeInt,
  cursor: writerCursorSchema,
  total: nonNegativeInt,
  evicted: nonNegativeInt,
  rows: Schema.Array(writerUnitSchema),
  next: Schema.NullOr(writerCursorSchema),
});
export type WriterUnitsReport = typeof writerUnitsReportSchema.Type;
const writerMetricsReportSchema = Schema.Struct({
  type: Schema.tag('writer-metrics'),
  writerId: nonEmptyString,
  reset: Schema.Boolean,
  cursor: writerCursorSchema,
  evictedOperations: nonNegativeInt,
  total: nonNegativeInt,
  boundariesMs: Schema.Array(Schema.Number),
  rows: Schema.Array(writerOperationSchema),
  next: Schema.NullOr(Schema.Struct({ writerId: nonEmptyString, series: nonNegativeInt })),
});
export type WriterMetricsReport = typeof writerMetricsReportSchema.Type;

export const PERFORMANCE_REPORT_SCHEMAS = [
  ledgerReportSchema,
  writerUnitsReportSchema,
  writerMetricsReportSchema,
  memoryReportSchema,
  capturesReportSchema,
  growthReportSchema,
  namesReportSchema,
  stallsReportSchema,
  stallReportSchema,
  slowReportSchema,
  traceReportSchema,
  breakdownReportSchema,
  vitalsReportSchema,
  metricsReportSchema,
  overviewReportSchema,
  profilesReportSchema,
  profileReportSchema,
  lossesReportSchema,
  commandsReportSchema,
  loadReportSchema,
] as const;

export const performanceReportSchema = Schema.Union(PERFORMANCE_REPORT_SCHEMAS).pipe(Schema.toTaggedUnion('type'));
export type PerformanceReport = typeof performanceReportSchema.Type;
