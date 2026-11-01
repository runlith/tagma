import { Effect, Schema } from 'effect';
import type { AgentFault } from '@runlith/acp/agent';
import { transportWebSchema } from '@runlith/agent/thread/record';
import { hostedContentSchema, hostedMessageSchema, hostedToolSchema, type HostedMessage } from './wire/messages.js';

export const HostedAgentSchema = Schema.Struct({ prompt: Schema.String, web: transportWebSchema });
export const HostedListedSchema = Schema.Struct({
  tools: Schema.Array(hostedToolSchema),
  names: Schema.Array(Schema.String),
  dispatch: Schema.Boolean,
});
export const HostedHeldSchema = Schema.Struct({ messages: Schema.Array(hostedMessageSchema) });
export const HostedOpenedSchema = Schema.Struct({
  context: Schema.NullOr(Schema.String),
  prompt: Schema.NullOr(Schema.String),
  web: transportWebSchema,
});
export const HostedCalledSchema = Schema.Struct({
  status: Schema.Literal('called'),
  content: Schema.Array(hostedContentSchema),
  failed: Schema.Boolean,
  offered: Schema.Boolean,
  words: Schema.Array(Schema.String),
});

export type HostedAgent = typeof HostedAgentSchema.Type;
export type HostedListed = typeof HostedListedSchema.Type;
export type HostedOpened = typeof HostedOpenedSchema.Type;
export type HostedCalled = typeof HostedCalledSchema.Type;

export interface HostedDoor {
  agent(): Effect.Effect<HostedAgent, AgentFault>;
  tools(): Effect.Effect<HostedListed, AgentFault>;
  history(): Effect.Effect<readonly HostedMessage[], AgentFault>;
  turn(): Effect.Effect<HostedOpened, AgentFault>;
  call(toolCallId: string, name: string, input: unknown): Effect.Effect<HostedCalled, AgentFault>;
}
