import { Schema } from 'effect';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const BackgroundWork = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  done: Count,
  total: Schema.NullOr(Count),
  startedAt: Schema.Number,
  remainingMs: Schema.NullOr(Schema.Number),
});
export type BackgroundWork = typeof BackgroundWork.Type;
