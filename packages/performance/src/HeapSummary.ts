import * as Schema from 'effect/Schema';

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));

export const heapClassSchema = Schema.Struct({
  name: Schema.String,
  count,
  sizeBytes: count,
});
export type HeapClass = typeof heapClassSchema.Type;

export const heapSummarySchema = Schema.Struct({
  sizeBytes: count,
  objectCount: count,
  detachedNodes: count,
  classes: Schema.Array(heapClassSchema),
});
export type HeapSummary = typeof heapSummarySchema.Type;

const delta = Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER })));

export const heapGrowthSchema = Schema.Struct({
  ...heapClassSchema.fields,
  countDelta: delta,
  sizeDelta: delta,
});
export type HeapGrowth = typeof heapGrowthSchema.Type;

export const heapReportSchema = Schema.Struct({
  ...heapSummarySchema.fields,
  classes: Schema.Array(heapGrowthSchema),
  classCount: count,
  growth: Schema.Array(heapGrowthSchema),
});
export type HeapReport = typeof heapReportSchema.Type;
