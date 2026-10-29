import { Effect, Stream } from 'effect';
import { refusingStream } from '../platform/contract/service/body.js';
import type { McpServers } from '../mcp/contract/service/servers.js';
import type { ConnectorCatalog } from './contract/service/catalog.js';
import { connectorRows } from './states.js';

export const connectorChannels = (servers: McpServers['Service'], catalog: ConnectorCatalog['Service']) => ({
  connectors: ({ projectId }: { readonly projectId: number }) =>
    refusingStream(
      Stream.mapEffect(servers.rows(projectId), (rows) => Effect.map(catalog.entries, (entries) => connectorRows(entries, rows))),
    ),
});
