import { refusingStream } from '../platform/contract/service/body.js';
import type { McpMount, McpServers } from './contract/service/servers.js';

export const mcpChannels = (servers: McpServers['Service']) => ({
  'mcp.resource.subscribe': ({ uri, resource, ...mount }: McpMount & { readonly uri: string; readonly resource: string }) =>
    refusingStream(servers.appWatch(mount, uri, { kind: 'operator', projectId: mount.projectId, view: resource })),
});
