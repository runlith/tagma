import { Schema } from 'effect';

export const AgentWaiting = Schema.Struct({
  reason: Schema.String,
  place: Schema.NullOr(Schema.String),
});
export type AgentWaiting = typeof AgentWaiting.Type;

export const AgentPhase = Schema.Struct({
  phase: Schema.Literals(['opening', 'preparing', 'calling', 'reasoning', 'writing', 'tools', 'compacting', 'retrying']),
  since: Schema.Number.check(Schema.isFinite()),
  waiting: Schema.optional(AgentWaiting),
});
export type AgentPhase = typeof AgentPhase.Type;
