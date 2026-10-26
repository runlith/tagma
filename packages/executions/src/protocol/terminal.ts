import { Schema } from 'effect';
import { ProcessWitness } from './evidence';

export const ForegroundRefusal = Schema.TaggedStruct('ForegroundRefused', {
  reason: Schema.Literals(['no-terminal', 'unsupported', 'unreadable']),
  detail: Schema.String,
});
export type ForegroundRefusal = typeof ForegroundRefusal.Type;

export const ForegroundAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Foreground'), process: ProcessWitness }),
  ForegroundRefusal,
]).pipe(Schema.toTaggedUnion('_tag'));
export type ForegroundAnswer = typeof ForegroundAnswer.Type;
