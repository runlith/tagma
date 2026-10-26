import type { PermissionSubject } from '@runlith/agent/permissions';
import type { McpToolCapabilities } from './McpCapabilities';
import { MCP_SERVER_NAME_PATTERN } from './McpServerDeclaration';

export const MCP_TOOL_PREFIX = 'mcp__';

export const MCP_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const MCP_MODEL_TOOL_NAME_MAX = 64;

export function mcpServerNameIsAddressable(server: string): boolean {
  return !server.includes('__') && !server.endsWith('_');
}

export type McpToolIdentity = {
  readonly server: string;
  readonly tool: string;
  readonly name: string;
  readonly subject: string;
};

export type McpToolNaming =
  | { readonly _tag: 'named'; readonly identity: McpToolIdentity }
  | { readonly _tag: 'unnamed'; readonly tool: string; readonly reason: string };

const unnamed = (tool: string, reason: string): McpToolNaming => ({ _tag: 'unnamed', tool, reason });

export function mcpToolIdentity(server: string, tool: string): McpToolNaming {
  if (!MCP_SERVER_NAME_PATTERN.test(server) || !mcpServerNameIsAddressable(server)) {
    return unnamed(tool, `the server name ${JSON.stringify(server)} cannot carry a tool name apart from its own`);
  }
  if (!MCP_TOOL_NAME_PATTERN.test(tool)) {
    return unnamed(tool, 'a tool name outside [a-zA-Z0-9_-] cannot be offered to a model or matched by a rule');
  }
  const name = `${MCP_TOOL_PREFIX}${server}__${tool}`;
  if (name.length > MCP_MODEL_TOOL_NAME_MAX) {
    return unnamed(tool, `the name ${name.length} characters long passes the ${MCP_MODEL_TOOL_NAME_MAX} a model accepts`);
  }
  return { _tag: 'named', identity: { server, tool, name, subject: `mcp:${server}/${tool}` } };
}

export function mcpToolNamed(name: string): { readonly server: string; readonly tool: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const at = rest.indexOf('__');
  if (at <= 0) return null;
  const server = rest.slice(0, at);
  const tool = rest.slice(at + 2);
  const naming = mcpToolIdentity(server, tool);
  return naming._tag === 'named' && naming.identity.name === name ? { server, tool } : null;
}

export const MCP_SERVER_SUBJECT_PREFIX = 'mcp-server:';

export function mcpToolSubjects(
  identity: McpToolIdentity,
  capabilities: McpToolCapabilities,
  serverIdentity: string,
  url: string | null,
): readonly PermissionSubject[] {
  const server = `${MCP_SERVER_SUBJECT_PREFIX}${serverIdentity}`;
  const declared = capabilities.kinds.flatMap((kind) => [
    { kind, value: identity.subject },
    { kind, value: server },
  ]);
  return url === null ? declared : [...declared, { kind: 'network', value: url }];
}
