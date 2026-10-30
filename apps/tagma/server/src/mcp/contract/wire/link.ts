import type { McpServerScope } from './servers.js';

export const MCP_SERVER_LINK = 'mcp-server';

export type McpServerLinkTarget = {
  readonly projectId: number;
  readonly scope: McpServerScope;
  readonly name: string;
  readonly contributor: string | null;
};
