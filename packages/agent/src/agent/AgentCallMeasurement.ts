import { Schema } from 'effect';
import { Usage } from '@runlith/llm/schema/events';

const messageCount = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const digest = Schema.String.check(Schema.isMinLength(1));

export const AgentRequestFootprint = Schema.Struct({
  messages: messageCount,
  messageDigest: digest,
  promptDigest: digest,
  toolDigests: Schema.Array(digest),
});
export type AgentRequestFootprint = typeof AgentRequestFootprint.Type;

export const AgentCallMeasurement = Schema.Struct({
  runId: Schema.String.check(Schema.isMinLength(1)),
  stepNumber: messageCount,
  attempt: messageCount,
  activity: Schema.optional(Schema.String),
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  account: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.NullOr(Schema.String)),
  usage: Usage,
  contextWindow: Schema.NullOr(Schema.Number),
  inputLimit: Schema.NullOr(Schema.Number),
  footprint: AgentRequestFootprint,
  measuredAt: Schema.String,
  sentAt: Schema.optional(Schema.String),
  cache: Schema.optional(Schema.Struct({ ttlSeconds: Schema.NullOr(Schema.Number) })),
});
export type AgentCallMeasurement = typeof AgentCallMeasurement.Type;
