import { Schema } from 'effect';
import { wordsSchema } from '../../../platform/contract/wire/refusal.js';

export const STEP_BACK_SUFFIX = '.back';

export const stepBackSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  carried: Schema.Boolean,
  journals: Schema.optional(Schema.Struct({ starts: Schema.Number, returned: Schema.Boolean })),
  failed: Schema.optional(Schema.Struct({ detail: Schema.String, words: Schema.optional(wordsSchema) })),
});
export type StepBack = typeof stepBackSchema.Type;
