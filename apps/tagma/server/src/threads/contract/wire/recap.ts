import { Schema } from 'effect';
import { RECAP_STATUSES, RecapBasis } from '../../../thread-record/contract/wire/recap.js';

export const recapReadingSchema = Schema.Struct({
  summary: Schema.String,
  next: Schema.NullOr(Schema.String),
  status: Schema.Literals(RECAP_STATUSES),
  basis: RecapBasis,
});
export type RecapReading = typeof recapReadingSchema.Type;

export const recapLineSchema = Schema.Struct({
  summary: Schema.String,
  next: Schema.NullOr(Schema.String),
  generatedAt: Schema.String,
  status: Schema.Literals(RECAP_STATUSES),
});
export type RecapLine = typeof recapLineSchema.Type;

export const recapAttemptSchema = Schema.Union([
  Schema.Struct({ state: Schema.tag('writing'), entryId: Schema.String }),
  Schema.Struct({
    state: Schema.tag('refused'),
    entryId: Schema.String,
    code: Schema.String,
    reason: Schema.String,
    unblock: Schema.Array(Schema.String),
  }),
]);
export type RecapAttempt = typeof recapAttemptSchema.Type;
