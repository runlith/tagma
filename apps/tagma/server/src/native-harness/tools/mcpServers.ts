import type { ToolCatalog } from '@runlith/agent/catalog';
import { mcpToolCatalog } from '@runlith/mcp/mcpToolCatalog';
import { mcpToolIdentity } from '@runlith/mcp/identity';
import type { Context } from 'effect';
import type { McpServers } from '../../mcp/contract/service/servers.js';
import type { McpBoundTools } from './mcpRule.js';
import type { Caller } from '../../platform/contract/wire/caller.js';

export type McpToolsContext = {
  readonly projectId: number;
  readonly caller: Caller;
  readonly workingRoot: string;
  readonly thread: { readonly id: string };
  readonly mcpServers: Context.Service.Shape<typeof McpServers>;
  readonly mcp: () => ReturnType<McpServers['Service']['palette']>;
  readonly mcpBound: McpBoundTools;
};

export function mcpServerTools(ctx: McpToolsContext): ToolCatalog {
  const pool = ctx.mcpServers.caller(ctx.projectId);
  const catalog: Record<string, ToolCatalog[string]> = {};
  for (const entry of ctx.mcp()) {
    const server = entry.declaration.name;
    const offered = mcpToolCatalog({
      projectId: ctx.projectId,
      declaration: entry.declaration,
      descriptors: entry.descriptors,
      pool,
      apps: true,
      roots: ctx.caller.files === null ? [ctx.workingRoot] : [ctx.workingRoot, ctx.caller.files.path],
    });
    for (const [tool, callable] of Object.entries(offered.tools)) {
      const naming = mcpToolIdentity(server, tool);
      if (naming._tag === 'named') catalog[naming.identity.name] = { ...callable, exposure: 'deferred' };
    }
  }
  ctx.mcpBound.bound(ctx.thread.id, Object.keys(catalog));
  return catalog;
}
