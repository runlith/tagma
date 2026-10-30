import { Schema } from 'effect';
import { TextPart, ReasoningPart, ToolCallPart, ToolResultPart } from '@runlith/llm/schema/messages';
import { ClientState } from '@runlith/acp/state';
import { AgentRuntimeGuidance } from '@runlith/agent/contracts';
import { start } from '@runlith/acp/client';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import { harnessExecutionSchema } from '../../threads/contract/wire/harness/observation.js';

export const OpenedTurn = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
  parts: Schema.Struct({ text: Schema.Number, reasoning: Schema.Number }),
  assistant: Schema.Array(Schema.Union([TextPart, ReasoningPart, ToolCallPart])),
  answered: Schema.optional(Schema.Array(ToolResultPart)),
  said: Schema.String,
  words: Schema.String,
  recorded: Schema.Boolean,
  noted: Schema.optional(AgentRuntimeGuidance),
});
export type OpenedTurn = typeof OpenedTurn.Type;

export const Steering = Schema.Struct({ request: Schema.String, turn: Schema.String, noted: Schema.optional(AgentRuntimeGuidance) });
export type Steering = typeof Steering.Type;

export const AgentOffer = Schema.Struct({
  load: Schema.Boolean,
  resume: Schema.Boolean,
  close: Schema.Boolean,
  login: Schema.NullOr(Schema.String),
  image: Schema.optional(Schema.Boolean),
});
export type AgentOffer = typeof AgentOffer.Type;

export const ForkOrigin = Schema.Struct({
  session: Schema.String,
  prompt: Schema.NullOr(Schema.String),
  account: Schema.optional(Schema.NullOr(Schema.String)),
});
export const Cut = Schema.Struct({ at: Schema.String, request: Schema.NullOr(Schema.String) });
export type Cut = typeof Cut.Type;

export const ProtocolRow = Schema.Struct({
  execution: Schema.NullOr(harnessExecutionSchema),
  client: ClientState,
  phase: Schema.Literals(['handshake', 'opening', 'ready']),
  agent: Schema.NullOr(AgentOffer),
  turns: Schema.Array(OpenedTurn),
  asked: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
  launches: Schema.Number,
  build: Schema.optional(Schema.String),
  rejections: Schema.Number,
  failure: Schema.NullOr(Schema.String),
  steering: Schema.Array(Steering),
  background: Schema.Number,
  fork: Schema.NullOr(ForkOrigin),
  configured: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
  cut: Schema.NullOr(Cut),
  context: Schema.NullOr(Schema.Struct({ used: Schema.Number, size: Schema.Number })),
  sent: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  compact: Schema.NullOr(
    Schema.Struct({
      turn: Schema.String,
      request: Schema.String,
      ids: Schema.Array(Schema.String),
      mode: Schema.Literals(['manual', 'automatic']),
      noticed: Schema.Boolean,
      inTurn: Schema.optional(Schema.Literals(['armed', 'compacting'])),
    }),
  ),
});
export type ProtocolRow = typeof ProtocolRow.Type;

export const stamped = (
  standing: ProtocolRow['sent'],
  before: readonly { readonly id: string }[],
  requests: readonly { readonly id: string }[],
  at: string,
): Readonly<Record<string, string>> => {
  const known = new Set(before.map((request) => request.id));
  return Object.fromEntries(
    requests.flatMap((request) => {
      const sent = standing?.[request.id] ?? (known.has(request.id) ? undefined : at);
      return sent === undefined ? [] : [[request.id, sent] as const];
    }),
  );
};

export const prompting = (row: ProtocolRow): boolean =>
  row.compact !== null || row.client.requests.some((request) => request.meaning === 'prompt');

const NEGOTIATION: ReadonlySet<string> = new Set(['initialize', 'new', 'load', 'resume', 'mode', 'configure']);

export const negotiating = (row: ProtocolRow): boolean =>
  row.client.requests.some((request) => NEGOTIATION.has(request.meaning) && !request.uncertain);

export const negotiates = (meaning: string): boolean => NEGOTIATION.has(meaning);

export const freshRow = (incarnation: string, carried: ProtocolRow | null, execution: HarnessExecutionRef | null): ProtocolRow => ({
  execution,
  client: start(incarnation),
  phase: 'handshake',
  agent: null,
  turns: [],
  asked: [],
  launches: carried?.launches ?? 0,
  rejections: carried?.rejections ?? 0,
  failure: null,
  steering: [],
  background: 0,
  fork: carried?.fork ?? null,
  configured: null,
  cut: null,
  context: carried?.context ?? null,
  compact: null,
});
