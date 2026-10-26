import { Schema } from 'effect';

export const phaseStampSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  pid: Schema.Int,
  startedAt: Schema.Finite,
  endedAt: Schema.NullOr(Schema.Finite),
  durationMs: Schema.NullOr(Schema.Finite),
  outcome: Schema.NullOr(Schema.Literals(['completed', 'failed', 'interrupted'])),
});
export type PhaseStamp = typeof phaseStampSchema.Type;
