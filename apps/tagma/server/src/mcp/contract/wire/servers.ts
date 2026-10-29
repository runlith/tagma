import { Schema } from 'effect';
import type { McpServerStatus } from '@runlith/mcp/McpPool';
import { MCP_OAUTH_CLIENT_KINDS } from '@runlith/mcp/grant';
import { McpStdioServerDeclaration, type McpServerDeclaration } from '@runlith/mcp/declaration';
import { SETTABLE_SCOPES, type SettableScope } from '../../../platform/contract/wire/setting.js';

export const mcpSignInSchema = Schema.Struct({
  signedIn: Schema.Boolean,
  pending: Schema.Boolean,
  client: Schema.NullOr(Schema.Literals(MCP_OAUTH_CLIENT_KINDS)),
}).annotate({
  description:
    'For an HTTP server: whether Tagma holds its tokens, whether a sign-in waits on its callback, and the kind of OAuth client it signs in with.',
});

export type McpSignInRow = typeof mcpSignInSchema.Type;

export const mcpReachSchema = Schema.Union([
  Schema.Struct({
    transport: Schema.Literal('stdio'),
    command: Schema.String,
    args: Schema.optional(Schema.Array(Schema.String)),
    cwd: Schema.optional(Schema.String),
    env: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    transport: Schema.Literal('http'),
    url: Schema.String,
    headers: Schema.Array(Schema.String),
  }),
]);

export type McpServerReach = typeof mcpReachSchema.Type;

export type McpServerRow = {
  readonly name: string;
  readonly scope: SettableScope;
  readonly reach: McpServerReach;
  readonly capabilities: McpServerDeclaration['capabilities'];
  readonly enabled: boolean;
  readonly identity: string;
  readonly status: McpServerRowStatus;
  readonly tools: number;
  readonly failure?: string;
  readonly needs?: readonly string[];
  readonly signIn?: McpSignInRow;
  readonly shadows?: SettableScope;
  readonly measuredAt: number;
};

const STATUS_WORDS: Record<McpServerStatus | 'pending' | 'needs-value', null> = {
  pending: null,
  'needs-value': null,
  'needs-sign-in': null,
  connecting: null,
  connected: null,
  failed: null,
  disabled: null,
};

export type McpServerRowStatus = keyof typeof STATUS_WORDS;

export const MCP_SERVER_STATUSES = Object.keys(STATUS_WORDS) as unknown as readonly [McpServerRowStatus, ...McpServerRowStatus[]];

export const mcpServerRowSchema = Schema.Struct({
  name: Schema.String,
  scope: Schema.Literals(SETTABLE_SCOPES),
  reach: mcpReachSchema,
  capabilities: McpStdioServerDeclaration.fields.capabilities,
  enabled: Schema.Boolean,
  identity: Schema.String,
  status: Schema.Literals(MCP_SERVER_STATUSES),
  tools: Schema.Number,
  failure: Schema.optional(Schema.String),
  needs: Schema.optional(
    Schema.Array(Schema.String).annotate({ description: 'The `${NAME}` references no secret value and no environment variable holds.' }),
  ),
  signIn: Schema.optional(mcpSignInSchema),
  shadows: Schema.optional(Schema.Literals(SETTABLE_SCOPES)),
  measuredAt: Schema.Number,
});
