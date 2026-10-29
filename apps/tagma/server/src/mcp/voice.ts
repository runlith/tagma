import type { McpServerRow } from './contract/wire/servers.js';

export const serversOf = (answer: unknown): readonly McpServerRow[] | null =>
  typeof answer === 'object' && answer !== null && 'mcp' in answer ? (answer as { readonly mcp: readonly McpServerRow[] }).mcp : null;

function mcpServersText(servers: readonly McpServerRow[]): string {
  if (servers.length === 0) return 'No MCP server is declared for this project.';
  return servers
    .map((row) => {
      const reached = row.reach.transport === 'stdio' ? [row.reach.command, ...(row.reach.args ?? [])].join(' ') : row.reach.url;
      const carried = row.reach.transport === 'stdio' ? row.reach.env : row.reach.headers;
      const configured = carried.length === 0 ? '' : ` +${carried.join(',')}`;
      const tools = row.status === 'connected' ? `, ${row.tools} tools` : '';
      const failure = row.failure === undefined ? '' : ` — ${row.failure}`;
      const needs = row.needs === undefined ? '' : ` — needs ${row.needs.join(', ')}`;
      const shadows = row.shadows === undefined ? '' : ` (shadows the ${row.shadows} entry)`;
      const scope = row.scope === 'user' ? ' [user]' : '';
      return `${row.name}${scope} [${row.status}${tools}] ${reached}${configured}${shadows}${needs}${failure}`;
    })
    .join('\n');
}

export function mcpText(answer: unknown): string | null {
  const servers = serversOf(answer);
  return servers === null ? null : mcpServersText(servers);
}
