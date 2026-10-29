import { family } from '@runlith/paging';
import { heapReportSchema } from '@runlith/performance/HeapSummary';
import { Schema } from 'effect';
import { Glance } from './page.js';

export const HEAP_CLASSES = family('page-heap-classes', 1, 'json', { text: 480, json: 480 }, 20, () => ({
  name: 'x'.repeat(80),
  count: 10_000,
  sizeBytes: 320_000,
  countDelta: 5_000,
  sizeDelta: 160_000,
}));

export const HeapCaptured = Schema.Struct({
  ...heapReportSchema.fields,
  page: Glance,
  path: Schema.String,
  bytes: Schema.Int,
  pausedMs: Schema.Finite,
  previous: Schema.NullOr(Schema.String),
  removed: Schema.Array(Schema.String),
});
export type HeapCaptured = typeof HeapCaptured.Type;
