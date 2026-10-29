import { Schema } from 'effect';

export const McpOAuthServer = Schema.Struct({
  url: Schema.String,
  issuer: Schema.optional(Schema.String),
  issuerInRedirect: Schema.Boolean,
  registers: Schema.Boolean,
  documents: Schema.Boolean,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  resource: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
});
export type McpOAuthServer = typeof McpOAuthServer.Type;

export const MCP_OAUTH_CLIENT_KINDS = ['pre-registered', 'document', 'registered'] as const;

export const McpOAuthClient = Schema.Struct({
  kind: Schema.Literals(MCP_OAUTH_CLIENT_KINDS),
  id: Schema.String,
  secret: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  redirects: Schema.Array(Schema.String),
});
export type McpOAuthClient = typeof McpOAuthClient.Type;

export const McpOAuthTokens = Schema.Struct({
  access: Schema.String,
  refresh: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
});
export type McpOAuthTokens = typeof McpOAuthTokens.Type;
