import { Schema } from 'effect';

export const CompactionContext = Schema.Struct({
  mode: Schema.Literals(['manual', 'automatic']),
  transcriptLocation: Schema.String,
  keep: Schema.optional(Schema.String),
});
export type CompactionContext = typeof CompactionContext.Type;

export const CompactionSummary = Schema.Struct({
  ...CompactionContext.fields,
  id: Schema.String,
  preservedCount: Schema.Number,
  previousMessageId: Schema.optional(Schema.String),
  previousRequestId: Schema.optional(Schema.String),
  toolReferences: Schema.optional(Schema.Array(Schema.String)),
});
export type CompactionSummary = typeof CompactionSummary.Type;
