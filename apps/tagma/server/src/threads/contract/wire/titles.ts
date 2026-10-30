import { Schema } from 'effect';

export const TITLE_STATUSES = ['named', 'no-topic', 'superseded', 'failed'] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];

export const TITLE_FAILURES = {
  'empty-answer': 'The model returned an empty answer.',
  'incomplete-answer': 'The model did not finish its answer normally.',
  'extra-lines': 'The model returned additional lines instead of one title.',
  'missing-frame': 'The answer did not use the required TITLE: frame.',
  'empty-title': 'The model returned an empty title.',
  'too-long': 'The returned title is too long to be a name.',
  'tool-call': 'The model called a tool instead of returning a title.',
  'model-failed': 'The model request failed.',
  timeout: 'The title request timed out.',
  cancelled: 'The title request was cancelled.',
  'account-unavailable': 'The account for the held request could not be resolved.',
  'thread-unavailable': 'The thread is unavailable for naming.',
  'input-too-large': 'The naming instruction exceeds the selected model window.',
  internal: 'The title request failed inside the server.',
} as const;
export type TitleFailure = keyof typeof TITLE_FAILURES;
export const TITLE_FRESH_REASONS = ['no-prefix', 'model-changed', 'account-changed', 'captured-rejected'] as const;
export type TitleFreshReason = (typeof TITLE_FRESH_REASONS)[number];

export const threadTitleAnswerSchema = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  outcome: Schema.Literals(TITLE_STATUSES),
  source: Schema.optional(Schema.Literals(['captured', 'fresh'])),
  freshReason: Schema.optional(Schema.Literals(TITLE_FRESH_REASONS)),
  reason: Schema.optional(Schema.Literals(Object.keys(TITLE_FAILURES) as TitleFailure[])),
  attemptId: Schema.optional(Schema.String),
});
export type ThreadTitleAnswer = typeof threadTitleAnswerSchema.Type;
