import { Schema } from 'effect';
import { family } from '@runlith/paging';
import { threadAskOptionSchema } from './list.js';

export const ATTENTION_KINDS = ['awaiting', 'failed', 'finished'] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_TEXT_CHARS = 240;
export const ATTENTION_OPTIONS = 4;
export const ATTENTION_LABEL_CHARS = 80;
export const ATTENTION_VALUE_CHARS = 200;

export const ATTENTION_FEED_ROWS = 200;

export const attentionFailureSchema = Schema.Struct({
  ending: Schema.Literals(['failed', 'cut']),
  reason: Schema.NullOr(Schema.String),
  type: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  httpStatus: Schema.NullOr(Schema.Int),
});

export const attentionRowSchema = Schema.Struct({
  project: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  threadId: Schema.String,
  title: Schema.String,
  name: Schema.NullOr(Schema.String),
  parentId: Schema.NullOr(Schema.String),
  kind: Schema.Literals(ATTENTION_KINDS),
  eventId: Schema.String,
  at: Schema.String,
  runId: Schema.NullOr(Schema.String),
  ask: Schema.NullOr(
    Schema.Struct({
      questionId: Schema.String,
      text: Schema.String,
      kind: Schema.Literals(['confirm', 'question']),
      options: Schema.Array(threadAskOptionSchema),
    }),
  ),
  said: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(attentionFailureSchema),
});
export type AttentionRow = typeof attentionRowSchema.Type;

const ID = '01a0cab9-6847-7602-bed6-3503d2788ccf';

export const ATTENTION = family('attention', 1, 'json', { text: 640, json: 2310 }, 20, () => ({
  project: { id: 5, name: 'x'.repeat(16) },
  threadId: ID,
  title: 'x'.repeat(80),
  name: 'x'.repeat(16),
  parentId: ID,
  kind: 'awaiting',
  eventId: `${ID}:${ID}`,
  at: '2026-10-04T20:24:16.059Z',
  runId: ID,
  ask: {
    questionId: ID,
    text: 'x'.repeat(ATTENTION_TEXT_CHARS),
    kind: 'question',
    options: Array.from({ length: ATTENTION_OPTIONS }, () => ({
      label: 'x'.repeat(ATTENTION_LABEL_CHARS),
      answers: [{ questionId: ID, values: ['x'.repeat(ATTENTION_VALUE_CHARS)] }],
    })),
  },
  said: null,
  failure: null,
}));

export const attentionFeedEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.tag('list'), rows: Schema.Array(attentionRowSchema), total: Schema.Number }),
  Schema.Struct({
    type: Schema.tag('change'),
    rows: Schema.Array(attentionRowSchema),
    removed: Schema.Array(Schema.String),
    total: Schema.Number,
  }),
]).pipe(Schema.toTaggedUnion('type'));
export type AttentionFeedEvent = typeof attentionFeedEventSchema.Type;
