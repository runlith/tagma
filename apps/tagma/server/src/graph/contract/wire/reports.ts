import { Schema } from 'effect';
import { sourceSchema, blockSchema, writerSchema } from './rows.js';
import { pageFacts } from './reads.js';

export const gaugesReportSchema = Schema.Struct({
  place: Schema.String,
  shown: Schema.Number,
  total: Schema.Number,
  next: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
  gauges: Schema.Array(
    Schema.Struct({
      source: sourceSchema,
      block: blockSchema,
      area: Schema.Struct({ name: Schema.String, title: Schema.String }),
    }),
  ),
  owners: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String, claims: Schema.Number })),
  touches: Schema.Array(
    Schema.Struct({
      writer: writerSchema,
      task: Schema.Struct({ name: Schema.String, title: Schema.String }),
      wrote: Schema.Boolean,
    }),
  ),
});
export type GaugesReportBody = typeof gaugesReportSchema.Type;

export const readyPageSchema = Schema.Struct({ rows: Schema.Array(blockSchema), ...pageFacts });
export type ReadyPageBody = typeof readyPageSchema.Type;

export const batchOutcomeSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  sourceSchema,
  Schema.Struct({
    ...blockSchema.fields,
    refsIn: Schema.optional(Schema.Array(Schema.String)),
  }),
]);
export type BatchOutcomeBody = typeof batchOutcomeSchema.Type;
