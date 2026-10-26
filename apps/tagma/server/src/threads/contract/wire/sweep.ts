import { Schema } from 'effect';

export const threadArchiveSweepSchema = Schema.Struct({
  moved: Schema.Array(Schema.String),
  working: Schema.Array(Schema.Struct({ threadId: Schema.String, runId: Schema.String })),
});
export type ThreadArchiveSweep = typeof threadArchiveSweepSchema.Type;
