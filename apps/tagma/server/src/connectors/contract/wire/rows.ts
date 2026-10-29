import { Schema } from 'effect';
import { MCP_SERVER_STATUSES } from '../../../mcp/contract/wire/servers.js';
import { SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';
import { feed } from '../../../platform/contract/wire/operation.js';
import { ConnectorEntry } from './entry.js';

export const CONNECTOR_STATES = ['available', ...MCP_SERVER_STATUSES] as const;

export const connectorRowSchema = Schema.Struct({
  ...ConnectorEntry.fields,
  state: Schema.Literals(CONNECTOR_STATES).annotate({
    description:
      'available: nothing declared from it here; otherwise the state of the MCP server it declared, as read_mcp_servers reads it.',
  }),
  server: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      scope: Schema.Literals(SETTABLE_SCOPES),
      changed: Schema.Boolean.annotate({
        description: 'The catalog now reaches the service at another address than the declared server; reconnecting declares it anew.',
      }),
    }),
  ).annotate({ description: 'The MCP server declared from this entry that this project resolves to.' }),
});
export type ConnectorRow = typeof connectorRowSchema.Type;

export const CONNECTORS_FEED = feed('connectors', {
  input: Schema.Struct({ projectId: Schema.Int.check(Schema.isGreaterThan(0)) }),
  event: Schema.Array(connectorRowSchema),
  refusals: ['secret-store-failed', 'unknown-project'],
  callers: 'operator',
  admission: 'project',
  graph: 'none',
});

export const CONNECTOR_FEEDS = [CONNECTORS_FEED] as const;
