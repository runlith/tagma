import { Schema } from 'effect';
import type { Fault } from '@runlith/ndjson-rpc/envelope';
import { ContentBlock } from './content';
import { RequestPermissionParams } from './methods';
import { ToolCall } from './toolCalls';

const PeerId = Schema.Union([Schema.String, Schema.Number]);

const FaultCodec: Schema.Codec<Fault> = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
});

const Sent = { id: Schema.String, admitted: Schema.Boolean, uncertain: Schema.Boolean };

const Words = Schema.Array(Schema.String);

export const ClientRequest = Schema.Union([
  Schema.Struct({ ...Sent, meaning: Schema.Literal('initialize') }),
  Schema.Struct({ ...Sent, meaning: Schema.Literal('new') }),
  Schema.Struct({ ...Sent, meaning: Schema.Literal('load'), sessionId: Schema.String }),
  Schema.Struct({ ...Sent, meaning: Schema.Literal('resume'), sessionId: Schema.String }),
  Schema.Struct({ ...Sent, meaning: Schema.Literal('prompt'), turn: Schema.String, envelopes: Words, cancelled: Schema.Boolean }),
  Schema.Struct({ ...Sent, meaning: Schema.Literal('configure'), configId: Schema.String }),
  Schema.Struct({ ...Sent, meaning: Schema.Literal('mode'), modeId: Schema.String }),
  Schema.Struct({ ...Sent, meaning: Schema.Literal('close'), sessionId: Schema.String }),
  Schema.Struct({ ...Sent, meaning: Schema.Literal('extension'), method: Schema.String, envelopes: Words }),
]);
export type ClientRequest = typeof ClientRequest.Type;

export const Reply = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Result'), result: Schema.Unknown }),
  Schema.Struct({ _tag: Schema.Literal('Error'), error: FaultCodec }),
]);
export type Reply = typeof Reply.Type;

const Asked = { id: PeerId, turn: Schema.NullOr(Schema.String), answer: Schema.NullOr(Reply), uncertain: Schema.Boolean };

export const AgentRequest = Schema.Union([
  Schema.Struct({ ...Asked, kind: Schema.Literal('permission'), params: RequestPermissionParams }),
  Schema.Struct({ ...Asked, kind: Schema.Literal('other'), method: Schema.String, params: Schema.Unknown }),
]);
export type AgentRequest = typeof AgentRequest.Type;

export const OpenMessage = Schema.Struct({
  stream: Schema.Literals(['message', 'thought']),
  messageId: Schema.NullOr(Schema.String),
  content: Schema.Array(ContentBlock),
});
export type OpenMessage = typeof OpenMessage.Type;

export const Turn = Schema.Struct({
  id: Schema.String,
  request: Schema.String,
  message: Schema.NullOr(OpenMessage),
  calls: Schema.Record(Schema.String, ToolCall),
});
export type Turn = typeof Turn.Type;

export const ClientState = Schema.Struct({
  incarnation: Schema.String,
  counter: Schema.Number,
  cursor: Schema.Struct({ offset: Schema.BigIntFromString, torn: Schema.Boolean }),
  requests: Schema.Array(ClientRequest),
  asks: Schema.Array(AgentRequest),
  turn: Schema.NullOr(Turn),
  stopping: Schema.NullOr(Schema.Number),
  extensions: Schema.Array(Schema.String),
});
export type ClientState = typeof ClientState.Type;
