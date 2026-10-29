import { Stream } from 'effect';
import { refusingStream } from '../platform/contract/service/body.js';
import type { McpSignInDoor } from './contract/service/door.js';
import type { McpMount, McpServers } from './contract/service/servers.js';
import { MCP_CALLBACK_PATH } from './contract/wire/callback.js';
import { mcpRowsAt } from './contract/wire/servers.js';

export const mcpChannels = (servers: McpServers['Service'], door: McpSignInDoor['Service']) => ({
  'mcp.resource.subscribe': ({ uri, resource, ...mount }: McpMount & { readonly uri: string; readonly resource: string }) =>
    refusingStream(servers.appWatch(mount, uri, { kind: 'operator', projectId: mount.projectId, view: resource })),
  'mcp.servers': ({ projectId }: { readonly projectId: number }) =>
    refusingStream(
      Stream.map(servers.rows(projectId), (rows) => {
        const origin = door.origin();
        return mcpRowsAt(rows, origin === null ? null : `${origin}${MCP_CALLBACK_PATH}`);
      }),
    ),
});
