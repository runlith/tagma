import { Schema } from 'effect';
import { harnessNameSchema } from '../../../threads/contract/wire/harness/names.js';

export const harnessCallSchema = Schema.Struct({
  id: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  tool: Schema.String.check(Schema.isMinLength(1)),
  subject: Schema.String.check(Schema.isMinLength(1)),
});
export type HarnessCall = typeof harnessCallSchema.Type;

const allowedSchema = Schema.Struct({
  _tag: Schema.Literal('Allowed'),
  ruleId: Schema.String,
  reason: Schema.NullOr(Schema.String),
});
const deniedSchema = Schema.Struct({
  _tag: Schema.Literal('Denied'),
  ruleId: Schema.String,
  reason: Schema.String,
});

export const harnessDecisionSchema = Schema.Union([
  allowedSchema,
  deniedSchema,
  Schema.Struct({ _tag: Schema.Literal('Asked'), requestId: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('Unspoken') }),
]);
export type HarnessDecision = typeof harnessDecisionSchema.Type;

export const harnessFollowupSchema = Schema.Struct({
  followup: Schema.String,
  harness: Schema.NullOr(harnessNameSchema),
  claim: Schema.NullOr(Schema.String),
  continued: Schema.Boolean,
});
export type HarnessFollowup = typeof harnessFollowupSchema.Type;

export const harnessCallAnswerSchema = Schema.Union([
  allowedSchema,
  deniedSchema,
  Schema.Struct({ _tag: Schema.Literal('Waiting') }),
  Schema.Struct({ _tag: Schema.Literal('Unanswered') }),
]);
export type HarnessAnswer = typeof harnessCallAnswerSchema.Type;
export type SettledHarnessAnswer = Exclude<HarnessAnswer, { readonly _tag: 'Waiting' }>;

export const PERMISSION_TIMEOUT_SECONDS = 300;

export const RUN_UNOWNED = 'run-unowned';
