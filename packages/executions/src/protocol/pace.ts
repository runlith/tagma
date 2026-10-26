import { Schema } from 'effect';

export const PACES = ['full', 'low', 'lowest'] as const;
export const Pace = Schema.Literals(PACES);
export type Pace = typeof Pace.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const PaceReport = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Applied'),
    pace: Pace,
    reached: Count,
    kept: Count,
    failed: Count,
  }),
  Schema.Struct({ _tag: Schema.Literal('Unavailable'), pace: Pace, reason: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type PaceReport = typeof PaceReport.Type;
