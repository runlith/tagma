import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { McpServerRow } from '../mcp/contract/wire/servers.js';
import type { SettableScope } from '../platform/contract/wire/setting.js';
import type { ConnectorEntry } from './contract/wire/entry.js';
import type { ConnectorRow } from './contract/wire/rows.js';

export const declarationOf = (entry: ConnectorEntry): McpServerDeclaration => ({
  name: entry.id,
  transport: 'http',
  url: entry.url,
  headers: entry.signIn.kind === 'key' ? entry.signIn.headers : undefined,
  capabilities: entry.capabilities,
  enabled: true,
});

export type DeclaredRow = McpServerRow & { readonly scope: SettableScope };

const declaredRow = (row: McpServerRow): row is DeclaredRow => row.scope !== 'contributed';

export const connectorRow = (entry: ConnectorEntry, server: DeclaredRow | undefined): ConnectorRow =>
  server === undefined
    ? { ...entry, state: 'available' }
    : {
        ...entry,
        state: server.status,
        server: {
          name: server.name,
          scope: server.scope,
          changed: server.reach.transport !== 'http' || server.reach.url !== entry.url,
        },
      };

export const declaredFrom = (entry: ConnectorEntry, servers: readonly McpServerRow[]): DeclaredRow | undefined =>
  servers.filter(declaredRow).find((row) => row.connector === entry.id);

export const connectorRows = (entries: readonly ConnectorEntry[], servers: readonly McpServerRow[]): readonly ConnectorRow[] =>
  entries.map((entry) => connectorRow(entry, declaredFrom(entry, servers)));
