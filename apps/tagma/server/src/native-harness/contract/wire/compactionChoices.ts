import { Schema } from 'effect';
import { THREAD_SUMMARIZER_REASONS, THREAD_SUMMARIZER_SKIP_REASONS } from '@runlith/agent/transcript/entries';
import { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';
import { SUMMARIZER_RULES } from './compactionSettings.js';

const skipReason = Schema.Literals(THREAD_SUMMARIZER_SKIP_REASONS);

export const summarizerSkipSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  reason: skipReason,
  until: Schema.optional(Schema.String),
});

export const summarizerRowSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  label: Schema.String,
  providerLabel: Schema.String,
  reasoning: Schema.NullOr(Schema.String),
  spendable: Schema.Boolean,
  skip: Schema.NullOr(Schema.Struct({ reason: skipReason, until: Schema.NullOr(Schema.String) })),
  pays: Schema.Struct({ provider: Schema.String, account: Schema.NullOr(Schema.String) }),
});
export type SummarizerRow = typeof summarizerRowSchema.Type;

export const compactionChoiceSchema = Schema.Struct({
  ...summarizerRowSchema.fields,
  own: Schema.Boolean,
  folds: Schema.Literals(['session', 'core']),
  estimate: Schema.NullOr(Schema.Struct({ inputTokens: Schema.Number, passes: Schema.NullOr(Schema.Number) })),
});
export type CompactionChoice = typeof compactionChoiceSchema.Type;

export const compactionSummarizersSchema = Schema.Struct({
  layer: Schema.Literals(SETTABLE_SCOPES),
  rule: Schema.Literals(SUMMARIZER_RULES),
  chain: Schema.Array(summarizerRowSchema),
});
export type CompactionSummarizersRead = typeof compactionSummarizersSchema.Type;

export const compactionWarmthSchema = Schema.Struct({
  state: Schema.Union([ThreadCacheWarmth.fields.state, Schema.Literal('running')]),
  invalidatedBy: ThreadCacheWarmth.fields.invalidatedBy,
});
export type CompactionWarmth = typeof compactionWarmthSchema.Type;

export const compactionChoicesSchema = Schema.Struct({
  threadId: Schema.String,
  rule: Schema.Literals(SUMMARIZER_RULES),
  warmth: compactionWarmthSchema,
  resolved: Schema.Struct({
    kind: Schema.Literals(['own', 'chain', 'none']),
    reason: Schema.Literals(THREAD_SUMMARIZER_REASONS),
    choice: Schema.NullOr(compactionChoiceSchema),
    skipped: Schema.Array(summarizerSkipSchema),
  }),
  own: Schema.NullOr(compactionChoiceSchema),
  chain: Schema.Array(compactionChoiceSchema),
  others: Schema.Struct({
    rows: Schema.Array(compactionChoiceSchema),
    shown: Schema.Number,
    total: Schema.Number,
    next: Schema.NullOr(Schema.String),
  }),
});
export type CompactionChoicesRead = typeof compactionChoicesSchema.Type;
