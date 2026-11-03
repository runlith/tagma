import { Schema } from 'effect';

export const capturedSourceSchema = Schema.Struct({
  head: Schema.NullOr(Schema.String),
  dirty: Schema.Boolean,
  tree: Schema.NullOr(Schema.String),
  inputs: Schema.Array(Schema.String),
});
export type CapturedSource = typeof capturedSourceSchema.Type;
