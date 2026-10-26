import { Schema } from 'effect';

export const CONVERSATION_ROLES = ['operator', 'agent'] as const;
export type ConversationRole = (typeof CONVERSATION_ROLES)[number];

export const TOTAL_CUTS = ['count-limit', 'short-terms'] as const;
export type TotalCut = (typeof TOTAL_CUTS)[number];

const spanSchema = Schema.Struct({ start: Schema.Int, end: Schema.Int });

export const conversationMessageSchema = Schema.Struct({
  entryId: Schema.String,
  at: Schema.Int,
  runId: Schema.NullOr(Schema.String),
  role: Schema.Literals(CONVERSATION_ROLES),
  occurredAt: Schema.String,
  text: Schema.String,
});
export type ConversationMessage = typeof conversationMessageSchema.Type;

export const conversationMatchSchema = Schema.Struct({
  entryId: Schema.String,
  position: Schema.Int,
  runId: Schema.NullOr(Schema.String),
  role: Schema.Literals(CONVERSATION_ROLES),
  occurredAt: Schema.String,
  snippet: Schema.String,
  highlights: Schema.Array(spanSchema),
});
export type ConversationMatch = typeof conversationMatchSchema.Type;

export const conversationHitSchema = Schema.Struct({
  project: Schema.NullOr(Schema.Struct({ id: Schema.Int, name: Schema.String })),
  threadId: Schema.String,
  title: Schema.String,
  name: Schema.NullOr(Schema.String),
  parentId: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  match: conversationMatchSchema,
});
export type ConversationHit = typeof conversationHitSchema.Type;

export const conversationCoverageSchema = Schema.Struct({
  complete: Schema.Boolean,
  unindexed: Schema.Int,
});
export type ConversationCoverage = typeof conversationCoverageSchema.Type;

export const conversationTallySchema = Schema.Struct({
  total: Schema.NullOr(Schema.Int),
  atLeast: Schema.optional(Schema.Int),
  cut: Schema.optional(Schema.Literals(TOTAL_CUTS)),
});
export type ConversationTally = typeof conversationTallySchema.Type;

export const conversationHeldSchema = Schema.Struct({
  question: Schema.String,
  boundary: Schema.String,
  emitted: Schema.Array(Schema.String),
  answered: Schema.Int,
  tally: conversationTallySchema,
  coverage: conversationCoverageSchema,
  excluded: Schema.NullOr(Schema.String),
  spelled: Schema.optional(Schema.Struct({ match: Schema.String, stems: Schema.Array(Schema.String) })),
});
export type ConversationHeld = typeof conversationHeldSchema.Type;

export const conversationWindowSchema = Schema.Union([
  Schema.Struct({
    threadId: Schema.String,
    at: Schema.Union([Schema.Int, Schema.String]),
    messages: Schema.Array(conversationMessageSchema),
  }),
  Schema.Struct({
    threadId: Schema.String,
    at: Schema.Union([Schema.Int, Schema.String]),
    missing: Schema.String,
  }),
]);
export type ConversationWindow = typeof conversationWindowSchema.Type;
