import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { mcpDeclarationFingerprint } from './mcpDeclarationFingerprint';
import {
  type McpHttpServerDeclaration as HttpDeclaration,
  McpHttpServerDeclaration,
  McpServerDeclaration,
  McpStdioServerDeclaration,
  mcpDeclarationsEqual,
  type McpStdioServerDeclaration as StdioDeclaration,
} from './McpServerDeclaration';

const decode = Schema.decodeUnknownResult(McpServerDeclaration);

const stdio: StdioDeclaration = {
  name: 'files',
  transport: 'stdio',
  command: 'mcp-files',
  args: ['--root', '.'],
  cwd: '/work',
  env: { API_TOKEN: 'x' },
  capabilities: { kinds: ['read'], mutates: false, tools: { save: { kinds: ['write'], mutates: true } } },
  enabled: true,
  timeoutMs: 5000,
};

const http: HttpDeclaration = {
  name: 'search',
  transport: 'http',
  url: 'https://mcp.example.test/mcp',
  headers: { Authorization: 'Bearer x' },
  capabilities: { kinds: ['network'], mutates: false },
  enabled: true,
};

const stdioChanges: Record<Exclude<keyof StdioDeclaration, 'version'>, unknown> = {
  name: 'files2',
  transport: 'http',
  command: 'other',
  args: ['--root', '/'],
  cwd: '/elsewhere',
  env: { API_TOKEN: 'y' },
  capabilities: { kinds: ['read'], mutates: true, tools: stdio.capabilities.tools },
  enabled: false,
  timeoutMs: 6000,
  maxCatalogBytes: 4096,
};

const httpChanges: Record<Exclude<keyof HttpDeclaration, 'version'>, unknown> = {
  name: 'search2',
  transport: 'stdio',
  url: 'https://other.example.test/mcp',
  headers: { Authorization: 'Bearer y' },
  capabilities: { kinds: ['network', 'read'], mutates: false },
  enabled: false,
  timeoutMs: 1,
  maxCatalogBytes: 8192,
};

describe('McpServerDeclaration codec', () => {
  it('reads legacy and tagged v1 declarations without changing session or grant identity', () => {
    for (const declaration of [stdio, http]) {
      const legacy = Schema.decodeUnknownSync(McpServerDeclaration)(declaration);
      const tagged = Schema.decodeUnknownSync(McpServerDeclaration)({ ...declaration, version: 1 });
      expect(tagged.version).toBe(1);
      expect(mcpDeclarationsEqual(legacy, tagged)).toBe(true);
      expect(mcpDeclarationFingerprint(tagged)).toBe(mcpDeclarationFingerprint(legacy));
      expect(decode({ ...declaration, version: 2 })._tag).toBe('Failure');
      expect(decode({ ...declaration, version: '1' })._tag).toBe('Failure');
      expect(decode({ ...declaration, capabilities: undefined })._tag).toBe('Failure');
    }
  });

  it('accepts a name of lowercase letters, digits, dash and underscore, and refuses any other spelling', () => {
    expect(decode(stdio)._tag).toBe('Success');
    expect(decode({ ...stdio, name: 'my-server_1' })._tag).toBe('Success');
    expect(decode({ ...stdio, name: 'Files' })._tag).toBe('Failure');
    expect(decode({ ...stdio, name: 'my server' })._tag).toBe('Failure');
    expect(decode({ ...stdio, name: '-files' })._tag).toBe('Failure');
  });

  it('requires a classification and refuses a timeout that is not a positive integer', () => {
    const { capabilities: _dropped, ...unclassified } = http;
    expect(decode(unclassified)._tag).toBe('Failure');
    expect(decode({ ...http, timeoutMs: 0 })._tag).toBe('Failure');
    expect(decode({ ...http, timeoutMs: 1.5 })._tag).toBe('Failure');
  });

  it('refuses a kind said twice, on the server default and on a tool alike', () => {
    expect(decode({ ...http, capabilities: { kinds: ['read', 'read'], mutates: false } })._tag).toBe('Failure');
    expect(
      decode({
        ...http,
        capabilities: { kinds: ['read'], mutates: false, tools: { save: { kinds: ['write', 'write'], mutates: true } } },
      })._tag,
    ).toBe('Failure');
    expect(decode({ ...http, capabilities: { kinds: ['read', 'network'], mutates: false } })._tag).toBe('Success');
  });
});

describe('mcpDeclarationsEqual', () => {
  it('compares every field the schema declares, so a change to any one of them restarts the server', () => {
    expect(Object.keys(stdioChanges).sort()).toEqual(
      Object.keys(McpStdioServerDeclaration.fields)
        .filter((field) => field !== 'version')
        .sort(),
    );
    expect(Object.keys(httpChanges).sort()).toEqual(
      Object.keys(McpHttpServerDeclaration.fields)
        .filter((field) => field !== 'version')
        .sort(),
    );
    for (const [field, value] of Object.entries(stdioChanges)) {
      const changed = { ...stdio, [field]: value } as McpServerDeclaration;
      expect([field, mcpDeclarationsEqual(stdio, changed)]).toEqual([field, false]);
    }
    for (const [field, value] of Object.entries(httpChanges)) {
      const changed = { ...http, [field]: value } as McpServerDeclaration;
      expect([field, mcpDeclarationsEqual(http, changed)]).toEqual([field, false]);
    }
  });

  it('holds two declarations equal by value, whatever the order kinds were written in', () => {
    expect(mcpDeclarationsEqual(stdio, { ...stdio, args: ['--root', '.'], env: { API_TOKEN: 'x' } })).toBe(true);
    const reordered: HttpDeclaration = { ...http, capabilities: { kinds: ['read', 'network'], mutates: false } };
    const twoKinds: HttpDeclaration = { ...http, capabilities: { kinds: ['network', 'read'], mutates: false } };
    expect(mcpDeclarationsEqual(twoKinds, reordered)).toBe(true);
  });

  it('compares kinds as a set, so a repeat is never mistaken for a different kind', () => {
    const repeated: HttpDeclaration = { ...http, capabilities: { kinds: ['read', 'read'], mutates: false } };
    const widened: HttpDeclaration = { ...http, capabilities: { kinds: ['read', 'write'], mutates: false } };
    expect(mcpDeclarationsEqual(repeated, widened)).toBe(false);
  });

  it('agrees with the fingerprint field for field, in both directions', () => {
    for (const [field, value] of Object.entries(stdioChanges)) {
      const changed = { ...stdio, [field]: value } as McpServerDeclaration;
      expect([field, mcpDeclarationFingerprint(stdio) === mcpDeclarationFingerprint(changed)]).toEqual([field, false]);
    }
    for (const [field, value] of Object.entries(httpChanges)) {
      const changed = { ...http, [field]: value } as McpServerDeclaration;
      expect([field, mcpDeclarationFingerprint(http) === mcpDeclarationFingerprint(changed)]).toEqual([field, false]);
    }
    const reordered: HttpDeclaration = {
      ...http,
      capabilities: { kinds: ['network'], mutates: false },
      headers: { Authorization: 'Bearer x' },
    };
    expect(mcpDeclarationFingerprint(http)).toBe(mcpDeclarationFingerprint(reordered));
    expect(mcpDeclarationsEqual(http, reordered)).toBe(true);
    expect(mcpDeclarationFingerprint(http)).not.toContain('Bearer');
    expect(mcpDeclarationFingerprint(stdio)).not.toContain('API_TOKEN');
  });

  it('holds a reclassified tool unequal, so a live session is never judged by words it no longer carries', () => {
    const reclassified: StdioDeclaration = {
      ...stdio,
      capabilities: { ...stdio.capabilities, tools: { save: { kinds: ['write'], mutates: false } } },
    };
    expect(mcpDeclarationsEqual(stdio, reclassified)).toBe(false);
  });
});
