import { Option, Schema } from 'effect';

export const RecapBasis = Schema.Struct({
  position: Schema.Int,
  entryId: Schema.String,
  runId: Schema.String,
  journalHead: Schema.Int,
  generatedAt: Schema.String,
  provider: Schema.String,
  model: Schema.String,
});
export type RecapBasis = typeof RecapBasis.Type;

export const ThreadRecap = Schema.Struct({
  summary: Schema.String,
  next: Schema.NullOr(Schema.String),
  basis: RecapBasis,
  voided: Schema.Boolean,
});
export type ThreadRecap = typeof ThreadRecap.Type;

const decodedRecap = Schema.decodeUnknownOption(ThreadRecap);

export const carriedRecap = (value: unknown): ThreadRecap | null =>
  value === null || value === undefined ? null : Option.getOrNull(decodedRecap(value));

export const RECAP_STATUSES = ['current', 'stale', 'void'] as const;
export type RecapStatus = (typeof RECAP_STATUSES)[number];
