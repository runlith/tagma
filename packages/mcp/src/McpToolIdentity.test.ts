import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { McpServerDeclaration } from './McpServerDeclaration';
import {
  MCP_MODEL_TOOL_NAME_MAX,
  mcpServerNameIsAddressable,
  type McpToolIdentity,
  mcpToolIdentity,
  mcpToolNamed,
  mcpToolSubjects,
} from './McpToolIdentity';

const decode = Schema.decodeUnknownResult(McpServerDeclaration);
const server = (name: string) =>
  decode({ name, transport: 'http', url: 'https://x.invalid/mcp', capabilities: { kinds: [], mutates: false }, enabled: true });

const named = (naming: ReturnType<typeof mcpToolIdentity>): McpToolIdentity | undefined =>
  naming._tag === 'named' ? naming.identity : undefined;

describe('mcpToolIdentity', () => {
  it('gives two distinct pairs two distinct names, and takes each apart into the pair it came from', () => {
    const first = named(mcpToolIdentity('a', 'b__c'));
    expect(first?.name).toBe('mcp__a__b__c');
    expect(mcpToolNamed('mcp__a__b__c')).toEqual({ server: 'a', tool: 'b__c' });
    expect(mcpToolIdentity('a__b', 'c')._tag).toBe('unnamed');
    expect(mcpToolIdentity('team_', 'search')._tag).toBe('unnamed');
    expect(server('a__b')._tag).toBe('Failure');
    expect(server('team_')._tag).toBe('Failure');
    expect(mcpServerNameIsAddressable('a__b')).toBe(false);
    expect(mcpServerNameIsAddressable('team_')).toBe(false);
    expect(mcpServerNameIsAddressable('my-server_1')).toBe(true);
    expect(server('my-server_1')._tag).toBe('Success');
    expect(server('f')._tag).toBe('Success');
    expect(server('Files')._tag).toBe('Failure');
  });

  it('round-trips every name it composes, including a tool that opens with the separator', () => {
    for (const [aServer, aTool] of [
      ['files', 'read'],
      ['a', '_x'],
      ['a_b', 'c'],
      ['my-server-1', 'read_file'],
      ['x', 'A-B_c9'],
    ] as const) {
      const identity = named(mcpToolIdentity(aServer, aTool));
      expect(identity).toBeDefined();
      expect(mcpToolNamed(identity?.name ?? '')).toEqual({ server: aServer, tool: aTool });
    }
  });

  it('refuses a name no provider would accept, saying which tool and why', () => {
    const sliced = mcpToolIdentity('files', 'read/private');
    expect(sliced._tag).toBe('unnamed');
    expect(sliced._tag === 'unnamed' && sliced.tool).toBe('read/private');
    expect(mcpToolIdentity('files', 'read file')._tag).toBe('unnamed');
    expect(mcpToolIdentity('files', 'x'.repeat(80))._tag).toBe('unnamed');
    const longest = named(mcpToolIdentity('files', 'x'.repeat(MCP_MODEL_TOOL_NAME_MAX - 'mcp__files__'.length)));
    expect(longest?.name.length).toBe(MCP_MODEL_TOOL_NAME_MAX);
    expect(mcpToolNamed('mcp__files__read/private')).toBeNull();
    expect(mcpToolNamed('read')).toBeNull();
  });

  it('names the tool inside its server, beside the declaration that offered it', () => {
    const identity = named(mcpToolIdentity('files', 'read'));
    expect(identity).toBeDefined();
    const subjects = mcpToolSubjects(identity as McpToolIdentity, { kinds: ['read'], mutates: false }, 'fp-one', null);
    expect(subjects).toEqual([
      { kind: 'read', value: 'mcp:files/read' },
      { kind: 'read', value: 'mcp-server:fp-one' },
    ]);
  });

  it('a read-only tool of a server reached over HTTP carries its network subject', () => {
    const identity = named(mcpToolIdentity('files', 'read')) as McpToolIdentity;
    const subjects = mcpToolSubjects(identity, { kinds: ['read'], mutates: false }, 'fp-one', 'https://mcp.example/rpc');
    expect(subjects).toContainEqual({ kind: 'network', value: 'https://mcp.example/rpc' });
  });
});
