import { Schema } from 'effect';
import { UseKind } from './verdict';

const Name = Schema.String.check(Schema.isMinLength(1));

export const At = Schema.TaggedStruct('at', {
  path: Name,
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  name: Name,
});
export type At = typeof At.Type;

export const Target = Schema.Union([At, Schema.TaggedStruct('member', { owner: Name, member: Name })]);
export type Target = typeof Target.Type;

export const ASKS = ['definition', 'uses'] as const;
export const Ask = Schema.Literals(ASKS);
export type Ask = typeof Ask.Type;

export const Question = Schema.Struct({
  ask: Ask,
  target: Target,
  kinds: Schema.optional(Schema.Array(UseKind)),
});
export type Question = typeof Question.Type;
