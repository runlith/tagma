import { Schema } from 'effect';
import type { McpServerStatus } from '@runlith/mcp/McpPool';
import { MCP_OAUTH_CLIENT_KINDS } from '@runlith/mcp/grant';
import { McpStdioServerDeclaration, type McpServerDeclaration } from '@runlith/mcp/declaration';
import { SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';

export const MCP_SERVER_SCOPES = [...SETTABLE_SCOPES, 'contributed'] as const;
export type McpServerScope = (typeof MCP_SERVER_SCOPES)[number];

export const mcpSignInSchema = Schema.Struct({
  signedIn: Schema.Boolean,
  pending: Schema.Boolean,
  client: Schema.NullOr(Schema.Literals(MCP_OAUTH_CLIENT_KINDS)),
  redirect: Schema.NullOr(Schema.String),
}).annotate({
  description:
    'For an HTTP server: whether Tagma holds its tokens, whether a sign-in waits on its callback, the kind of OAuth client it signs in with, and the address a sign-in begun through this door returns to — the one to register for a client of your own.',
});

export type McpSignInRow = typeof mcpSignInSchema.Type;

export const mcpRowsAt = (rows: readonly McpServerRow[], redirect: string | null): readonly McpServerRow[] =>
  rows.map((row) => (row.signIn === undefined ? row : { ...row, signIn: { ...row.signIn, redirect } }));

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
  readonly scope: McpServerScope;
  readonly reach: McpServerReach;
  readonly capabilities: McpServerDeclaration['capabilities'];
  readonly enabled: boolean;
  readonly identity: string;
  readonly status: McpServerRowStatus;
  readonly tools: number;
  readonly failure?: string;
  readonly needs?: readonly string[];
  readonly signIn?: McpSignInRow;
  readonly shadows?: McpServerScope;
  readonly contributor?: string;
  readonly measuredAt: number;
};

export function mcpServerShown(row: McpServerRow): string {
  if (row.contributor === undefined) return row.name;
  if (row.reach.transport === 'http' && URL.canParse(row.reach.url)) return new URL(row.reach.url).host;
  const own = row.name.slice(row.contributor.length + 1);
  return row.name.startsWith(`${row.contributor}-`) && own !== '' ? own : row.name;
}

const STATUS_WORDS: Record<McpServerStatus | 'pending' | 'needs-value' | 'declined', null> = {
  declined: null,
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
  scope: Schema.Literals(MCP_SERVER_SCOPES),
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
  shadows: Schema.optional(Schema.Literals(MCP_SERVER_SCOPES)),
  contributor: Schema.optional(Schema.String).annotate({
    description: 'For a contributed server: what contributed it to this project, such as the plugin enabled here that brings it.',
  }),
  measuredAt: Schema.Number,
});
