import * as Schema from 'effect/Schema';

const nonEmptyString = Schema.String.check(Schema.isMinLength(1));
const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const nonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const HEAP_SNAPSHOT_STEPS = ['admit', 'prune', 'snapshot', 'write', 'hold'] as const;
export const heapSnapshotStepSchema = Schema.Literals(HEAP_SNAPSHOT_STEPS);
export type HeapSnapshotStep = typeof heapSnapshotStepSchema.Type;

export const heapSnapshotRequestSchema = Schema.Struct({
  requestedBy: nonEmptyString,
});
export type HeapSnapshotRequest = typeof heapSnapshotRequestSchema.Type;

export const heapSnapshotSchema = Schema.Struct({
  id: nonEmptyString,
  instanceId: nonEmptyString,
  requestedBy: nonEmptyString,
  wallTime: nonNegativeInt,
  file: nonEmptyString,
  bytes: nonNegativeInt,
  snapshotMs: nonNegativeNumber,
  writeMs: nonNegativeNumber,
  heap: Schema.Struct({
    sizeBytes: nonNegativeNumber,
    extraMemoryBytes: nonNegativeNumber,
    objectCount: nonNegativeNumber,
  }),
  kept: Schema.Array(nonEmptyString),
});
export type HeapSnapshot = typeof heapSnapshotSchema.Type;
