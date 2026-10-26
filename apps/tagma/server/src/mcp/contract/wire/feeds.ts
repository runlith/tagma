import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';

export const MCP_APP_REFUSALS = [
  'mcp-server-unavailable',
  'mcp-server-replaced',
  'mcp-resource-failed',
  'mcp-tool-unoffered',
  'mcp-call-failed',
  'mcp-reconcile-stalled',
  'unknown-project',
] as const;

export const mcpMeta = Schema.Record(Schema.String, Schema.Unknown);

export const mcpServerName = Schema.String.check(Schema.isMinLength(1)).annotate({
  description: 'The server whose view asks, as it was declared.',
});

export const mcpViewResource = Schema.String.check(Schema.isStartingWith('ui://')).annotate({
  description: 'The ui:// resource of the view.',
});

export const McpResourceEvent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('subscribed') }),
  Schema.Struct({ kind: Schema.Literal('updated'), uri: Schema.String, _meta: Schema.optional(mcpMeta) }),
]);
export type McpResourceEvent = typeof McpResourceEvent.Type;

export const MCP_RESOURCE_FEED = feed('mcp.resource.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    server: mcpServerName,
    identity: Schema.String,
    resource: mcpViewResource,
    uri: Schema.String,
  }),
  event: McpResourceEvent,
  refusals: MCP_APP_REFUSALS,
  callers: 'operator',
  admission: 'project',
});

export const MCP_FEEDS = [MCP_RESOURCE_FEED] as const;
