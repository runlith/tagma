import { Schema } from 'effect';
import { wordsSchema } from '../../../platform/contract/wire/refusal.js';

export const attemptEndSchema = Schema.Struct({
  detail: Schema.String,
  data: Schema.Literals(['untouched', 'restored', 'unrestored', 'kept']),
  words: Schema.optional(wordsSchema),
  left: Schema.optional(Schema.String),
});
export type AttemptEnd = typeof attemptEndSchema.Type;

export const attemptSchema = Schema.Struct({
  from: Schema.NullOr(Schema.String),
  to: Schema.String,
  starts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  copied: Schema.Boolean,
  ended: Schema.NullOr(attemptEndSchema),
});
export type Attempt = typeof attemptSchema.Type;

export const ATTEMPT_OPEN = 'attempt-open';

export const returnSchema = Schema.Struct({
  left: Schema.String,
  to: Schema.String,
});
export type Return = typeof returnSchema.Type;

export const ATTEMPT_STARTS = 2;

export const servingSchema = Schema.Struct({ release: Schema.String });
