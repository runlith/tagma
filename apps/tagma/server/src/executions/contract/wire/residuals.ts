import { Schema } from 'effect';
import { ResidualEnding, ResidualInput } from '@runlith/executions/protocol/stop';

export const ResidualUnreached = Schema.Struct({
  _tag: Schema.Literal('Unreached'),
  ...ResidualInput.fields,
  failure: Schema.NonEmptyString,
  detail: Schema.String,
});

export const ResidualOutcome = Schema.Union([...Object.values(ResidualEnding.cases), ResidualUnreached]).pipe(Schema.toTaggedUnion('_tag'));
export type ResidualOutcome = typeof ResidualOutcome.Type;

export const ResidualEnded = Schema.Struct({ outcome: ResidualEnding });

export const ResidualsEnded = Schema.Struct({ outcomes: Schema.Array(ResidualOutcome) });
