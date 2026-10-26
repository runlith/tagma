import { Schema } from 'effect';
import { ContentBlock, Meta, Text } from './content';
import { ToolCallUpdate } from './toolCalls';
import { SessionConfigOption, SessionModeState } from './updates';

export const PROTOCOL = 1;

const Flag = Schema.optional(Schema.Boolean);

const Capability = Schema.optionalKey(Schema.NullOr(Schema.Struct({ _meta: Meta })));

export const Implementation = Schema.Struct({ name: Schema.String, title: Text, version: Schema.String, _meta: Meta });
export type Implementation = typeof Implementation.Type;

export const ClientCapabilities = Schema.Struct({
  fs: Schema.optional(Schema.Struct({ readTextFile: Flag, writeTextFile: Flag, _meta: Meta })),
  terminal: Flag,
  auth: Schema.optional(Schema.Struct({ terminal: Flag, _meta: Meta })),
  elicitation: Schema.optional(Schema.Unknown),
  session: Schema.optional(Schema.Unknown),
  _meta: Meta,
});
export type ClientCapabilities = typeof ClientCapabilities.Type;

export const InitializeParams = Schema.Struct({
  protocolVersion: Schema.Number,
  clientCapabilities: Schema.optional(ClientCapabilities),
  clientInfo: Schema.optionalKey(Schema.NullOr(Implementation)),
  _meta: Meta,
});
export type InitializeParams = typeof InitializeParams.Type;

export const AgentCapabilities = Schema.Struct({
  loadSession: Flag,
  promptCapabilities: Schema.optional(Schema.Struct({ image: Flag, audio: Flag, embeddedContext: Flag, _meta: Meta })),
  mcpCapabilities: Schema.optional(Schema.Struct({ http: Flag, sse: Flag, _meta: Meta })),
  sessionCapabilities: Schema.optional(
    Schema.Struct({
      list: Capability,
      delete: Capability,
      additionalDirectories: Capability,
      resume: Capability,
      close: Capability,
      _meta: Meta,
    }),
  ),
  auth: Schema.optional(Schema.Unknown),
  _meta: Meta,
});
export type AgentCapabilities = typeof AgentCapabilities.Type;

export const AuthMethod = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('terminal'),
    id: Schema.String,
    name: Schema.String,
    description: Text,
    args: Schema.optional(Schema.Array(Schema.String)),
    env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    _meta: Meta,
  }),
  Schema.Struct({ type: Schema.optional(Schema.String), id: Schema.String, name: Schema.String, description: Text, _meta: Meta }),
]);
export type AuthMethod = typeof AuthMethod.Type;

export const InitializeResult = Schema.Struct({
  protocolVersion: Schema.Number,
  agentCapabilities: Schema.optional(AgentCapabilities),
  authMethods: Schema.optional(Schema.Array(AuthMethod)),
  agentInfo: Schema.optionalKey(Schema.NullOr(Implementation)),
  _meta: Meta,
});
export type InitializeResult = typeof InitializeResult.Type;

const Pair = Schema.Struct({ name: Schema.String, value: Schema.String, _meta: Meta });

export const McpServer = Schema.Union([
  Schema.Struct({ type: Schema.Literal('http'), name: Schema.String, url: Schema.String, headers: Schema.Array(Pair), _meta: Meta }),
  Schema.Struct({ type: Schema.Literal('sse'), name: Schema.String, url: Schema.String, headers: Schema.Array(Pair), _meta: Meta }),
  Schema.Struct({
    type: Schema.optional(Schema.Literal('stdio')),
    name: Schema.String,
    command: Schema.String,
    args: Schema.Array(Schema.String),
    env: Schema.Array(Pair),
    _meta: Meta,
  }),
]);
export type McpServer = typeof McpServer.Type;

const Directories = Schema.optional(Schema.Array(Schema.String));

export const NewSessionParams = Schema.Struct({
  cwd: Schema.String,
  additionalDirectories: Directories,
  mcpServers: Schema.Array(McpServer),
  _meta: Meta,
});
export type NewSessionParams = typeof NewSessionParams.Type;

export const LoadSessionParams = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
  additionalDirectories: Directories,
  mcpServers: Schema.Array(McpServer),
  _meta: Meta,
});
export type LoadSessionParams = typeof LoadSessionParams.Type;

export const ResumeSessionParams = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
  additionalDirectories: Directories,
  mcpServers: Schema.optional(Schema.Array(McpServer)),
  _meta: Meta,
});
export type ResumeSessionParams = typeof ResumeSessionParams.Type;

export const SessionSetup = Schema.Struct({
  modes: Schema.optionalKey(Schema.NullOr(SessionModeState)),
  configOptions: Schema.optionalKey(Schema.NullOr(Schema.Array(SessionConfigOption))),
  _meta: Meta,
});
export type SessionSetup = typeof SessionSetup.Type;

export const NewSessionResult = Schema.Struct({ sessionId: Schema.String, ...SessionSetup.fields });
export type NewSessionResult = typeof NewSessionResult.Type;

export const SetSessionConfigOptionParams = Schema.Union([
  Schema.Struct({ sessionId: Schema.String, configId: Schema.String, type: Schema.Literal('boolean'), value: Schema.Boolean, _meta: Meta }),
  Schema.Struct({ sessionId: Schema.String, configId: Schema.String, value: Schema.String, _meta: Meta }),
]);
export type SetSessionConfigOptionParams = typeof SetSessionConfigOptionParams.Type;

export const SetSessionConfigOptionResult = Schema.Struct({ configOptions: Schema.Array(SessionConfigOption), _meta: Meta });
export type SetSessionConfigOptionResult = typeof SetSessionConfigOptionResult.Type;

export const SetSessionModeParams = Schema.Struct({ sessionId: Schema.String, modeId: Schema.String, _meta: Meta });
export type SetSessionModeParams = typeof SetSessionModeParams.Type;

export const SessionParams = Schema.Struct({ sessionId: Schema.String, _meta: Meta });
export type SessionParams = typeof SessionParams.Type;

export const PromptParams = Schema.Struct({ sessionId: Schema.String, prompt: Schema.Array(ContentBlock), _meta: Meta });
export type PromptParams = typeof PromptParams.Type;

export const StopReason = Schema.Literals(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']);
export type StopReason = typeof StopReason.Type;

const Tokens = Schema.optionalKey(Schema.NullOr(Schema.Number));

export const Usage = Schema.Struct({
  totalTokens: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  thoughtTokens: Tokens,
  cachedReadTokens: Tokens,
  cachedWriteTokens: Tokens,
  _meta: Meta,
});
export type Usage = typeof Usage.Type;

export const PromptResult = Schema.Struct({ stopReason: StopReason, usage: Schema.optionalKey(Schema.NullOr(Usage)), _meta: Meta });
export type PromptResult = typeof PromptResult.Type;

export const PermissionOption = Schema.Struct({
  optionId: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(['allow_once', 'allow_always', 'reject_once', 'reject_always']),
  _meta: Meta,
});
export type PermissionOption = typeof PermissionOption.Type;

export const RequestPermissionParams = Schema.Struct({
  sessionId: Schema.String,
  toolCall: ToolCallUpdate,
  options: Schema.Array(PermissionOption),
  _meta: Meta,
});
export type RequestPermissionParams = typeof RequestPermissionParams.Type;

export const PermissionOutcome = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('cancelled') }),
  Schema.Struct({ outcome: Schema.Literal('selected'), optionId: Schema.String, _meta: Meta }),
]);
export type PermissionOutcome = typeof PermissionOutcome.Type;

export const RequestPermissionResult = Schema.Struct({ outcome: PermissionOutcome, _meta: Meta });
export type RequestPermissionResult = typeof RequestPermissionResult.Type;

export const CancelRequestParams = Schema.Struct({ requestId: Schema.Union([Schema.String, Schema.Number]), _meta: Meta });
