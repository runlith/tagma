import { Context } from 'effect';
import { type LiveDeclaration, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { McpServers } from '../mcp/contract/service/servers.js';
import { ConnectorCatalog } from './contract/service/catalog.js';
import { connectors as declaration } from './contract/wire/module.js';
import { CONNECTOR_FEEDS } from './contract/wire/rows.js';

const live: LiveDeclaration<typeof CONNECTOR_FEEDS, McpServers | ConnectorCatalog> = liveOf(CONNECTOR_FEEDS, async (door) =>
  (await import('./feeds.js')).connectorChannels(Context.get(door, McpServers), Context.get(door, ConnectorCatalog)),
);

export const connectors = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).CONNECTOR_PAIRS),
  live,
});
