import { Schema } from 'effect';

export const retainedToolValueSchema = Schema.Struct({
  truncated: Schema.Literal(true),
  outputId: Schema.String,
  byteLength: Schema.Number,
  lineCount: Schema.Number,
  preview: Schema.String,
  format: Schema.Literal('json'),
});

export type RetainedToolValue = typeof retainedToolValueSchema.Type;

const isRetainedToolValue = Schema.is(retainedToolValueSchema);

export function retainedToolValue(output: unknown): RetainedToolValue | null {
  return isRetainedToolValue(output) ? output : null;
}
