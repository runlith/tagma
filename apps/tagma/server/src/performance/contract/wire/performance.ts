import { cpuProfileOperationSchema } from '@runlith/performance/CpuProfile';
import { heapSnapshotSchema, heapSnapshotStepSchema } from '@runlith/performance/HeapSnapshot';
import { lossKindCountsSchema, memoryRecordSchema, profileRecordSchema } from '@runlith/performance/protocol/records';
import { performancePointQuerySchema } from '@runlith/performance/protocol/queries';
import { PERFORMANCE_REPORT_SCHEMAS, retainedRangeSchema } from '@runlith/performance/protocol/reports';
import { Schema } from 'effect';

const performanceNotFoundSchema = Schema.Struct({
  type: Schema.tag('not-found'),
  query: performancePointQuerySchema,
  inheritedDrops: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  sessionDrops: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  inheritedDroppedKinds: Schema.NullOr(lossKindCountsSchema),
  sessionDroppedKinds: lossKindCountsSchema,
  retainedRange: retainedRangeSchema,
});

const performanceUnavailableSchema = Schema.Struct({
  type: Schema.tag('unavailable'),
  message: Schema.String,
});

const performanceQueryFailedSchema = Schema.Struct({
  type: Schema.tag('query-failed'),
  message: Schema.String,
});

const performanceReadTimedOutSchema = Schema.Struct({
  type: Schema.tag('read-timed-out'),
  message: Schema.String,
});

export const performanceReadValueSchema = Schema.Union([
  ...PERFORMANCE_REPORT_SCHEMAS,
  performanceNotFoundSchema,
  performanceUnavailableSchema,
  performanceQueryFailedSchema,
  performanceReadTimedOutSchema,
]).pipe(Schema.toTaggedUnion('type'));

export type PerformanceReadValue = typeof performanceReadValueSchema.Type;

const performanceCapturedSchema = Schema.Struct({
  type: Schema.tag('captured'),
  profile: profileRecordSchema,
  cuts: Schema.Array(Schema.Struct({ id: Schema.String, requestedBy: Schema.String })),
});

const performanceCaptureFailedSchema = Schema.Struct({
  type: Schema.tag('capture-failed'),
  operation: cpuProfileOperationSchema,
  message: Schema.String,
});

const performanceReadingKeptSchema = Schema.Struct({
  type: Schema.tag('reading-kept'),
  reading: memoryRecordSchema,
});

const performanceReadingNotKeptSchema = Schema.Struct({
  type: Schema.tag('reading-not-kept'),
  reason: Schema.Literals(['pending-limit', 'store-unavailable']),
  message: Schema.String,
});

const performanceSnapshotKeptSchema = Schema.Struct({
  type: Schema.tag('snapshot-kept'),
  snapshot: heapSnapshotSchema,
});

const performanceSnapshotFailedSchema = Schema.Struct({
  type: Schema.tag('snapshot-failed'),
  step: heapSnapshotStepSchema,
  message: Schema.String,
});

export const performanceCaptureValueSchema = Schema.Union([
  performanceCapturedSchema,
  performanceReadingKeptSchema,
  performanceReadingNotKeptSchema,
  performanceSnapshotKeptSchema,
  performanceSnapshotFailedSchema,
  performanceCaptureFailedSchema,
  performanceUnavailableSchema,
]).pipe(Schema.toTaggedUnion('type'));

export type PerformanceCaptureValue = typeof performanceCaptureValueSchema.Type;
export type PerformanceValue = PerformanceReadValue | PerformanceCaptureValue;

export const HandedArtifact = Schema.Struct({
  file: Schema.String,
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type HandedArtifact = typeof HandedArtifact.Type;

export type PerformanceAnswer = {
  readonly status: 'ok';
  readonly performance: PerformanceValue;
  readonly artifact?: HandedArtifact;
};
