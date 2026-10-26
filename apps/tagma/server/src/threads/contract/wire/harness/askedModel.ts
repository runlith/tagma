import { Schema } from 'effect';

export const harnessAskedModelSchema = Schema.Struct({
  model: Schema.String,
  reasoning: Schema.NullOr(Schema.String),
});
export type HarnessAskedModel = typeof harnessAskedModelSchema.Type;
