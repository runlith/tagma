import { describe, expect, it } from 'bun:test';
import { type McpCapabilities, mcpToolCapabilities } from './McpCapabilities';
import { type McpToolIdentity, mcpToolIdentity, mcpToolSubjects } from './McpToolIdentity';

const classification: McpCapabilities = {
  kinds: ['read'],
  mutates: false,
  tools: { save: { kinds: ['write'], mutates: true } },
};

const identity = (server: string, tool: string): McpToolIdentity => {
  const naming = mcpToolIdentity(server, tool);
  if (naming._tag === 'unnamed') throw new Error(`${server}/${tool} has no identity: ${naming.reason}`);
  return naming.identity;
};

const SERVER_IDENTITY = 'fingerprint-of-the-declaration';

const subjects = (server: string, tool: string, capabilities: McpCapabilities = classification) =>
  mcpToolSubjects(identity(server, tool), mcpToolCapabilities(tool, capabilities), SERVER_IDENTITY, null);

describe('MCP capability classification', () => {
  it('classifies two tools of one server differently, per tool replacing the server default whole', () => {
    expect(subjects('files', 'read')).toEqual([
      { kind: 'read', value: 'mcp:files/read' },
      { kind: 'read', value: `mcp-server:${SERVER_IDENTITY}` },
    ]);
    expect(subjects('files', 'save')).toEqual([
      { kind: 'write', value: 'mcp:files/save' },
      { kind: 'write', value: `mcp-server:${SERVER_IDENTITY}` },
    ]);
    expect(mcpToolCapabilities('read', classification).mutates).toBe(false);
    expect(mcpToolCapabilities('save', classification).mutates).toBe(true);
  });

  it('reads its own entries only, so a tool named after a prototype member takes the server default', () => {
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(mcpToolCapabilities(inherited, classification)).toEqual({ kinds: ['read'], mutates: false });
      expect(subjects('files', inherited)).toEqual([
        { kind: 'read', value: `mcp:files/${inherited}` },
        { kind: 'read', value: `mcp-server:${SERVER_IDENTITY}` },
      ]);
    }
  });

  it('declares no subject for an empty classification', () => {
    const silent: McpCapabilities = { kinds: [], mutates: true };
    expect(subjects('audit', 'log', silent)).toEqual([]);
  });
});
