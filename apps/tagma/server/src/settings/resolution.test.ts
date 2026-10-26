import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey, settingListKey } from '../platform/contract/wire/setting.js';
import { resolveSetting, type SettingLayer } from './resolution.js';

const contextFilesEnabled = settingKey({
  id: 'agent.contextFiles.enabled',
  order: 10,
  title: 'Flag',
  description: 'A boolean key.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

const skillProjectDirectories = settingKey({
  id: 'skills.directories.project',
  order: 10,
  title: 'Directories',
  description: 'A concatenating list key.',
  schema: Schema.Array(Schema.String),
  fallback: [] as readonly string[],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

const contextFileNames = settingKey({
  id: 'agent.contextFiles.names',
  order: 10,
  title: 'Names',
  description: 'A replacing list key.',
  schema: Schema.Array(Schema.String),
  fallback: ['TAGMA.md', 'AGENTS.md', 'CLAUDE.md'] as readonly string[],
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

const McpServer = Schema.Struct({ name: Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/u)) });

const mcpServers = settingListKey({
  id: 'mcp.servers',
  order: 10,
  title: 'Servers',
  description: 'A list key read member by member.',
  member: McpServer,
  fallback: [] as readonly (typeof McpServer.Type)[],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

const userBudget = settingKey({
  id: 'traces.maxBytes',
  order: 10,
  title: 'Budget',
  description: 'A user-only positive number.',
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  fallback: 5_000,
  scopes: ['user'],
  merge: 'replace',
});

function layer(scope: 'user' | 'project', values: Record<string, unknown>, declined: string[] = []): SettingLayer {
  return { scope, values: new Map(Object.entries(values)), declined: new Set(declined), writers: new Map() };
}

describe('resolving a setting over the scope chain', () => {
  it('answers the key default when nobody set it', () => {
    const resolved = resolveSetting(contextFilesEnabled, []);
    expect(resolved.value).toBe(true);
    expect(resolved.from).toBe('default');
  });

  it('lets a project decide what the user only proposed', () => {
    const resolved = resolveSetting(contextFilesEnabled, [
      layer('user', { 'agent.contextFiles.enabled': true }),
      layer('project', { 'agent.contextFiles.enabled': false }),
    ]);
    expect(resolved.value).toBe(false);
    expect(resolved.from).toBe('project');
  });

  it('concatenates a list key user-first, so a project appends rather than truncates', () => {
    const resolved = resolveSetting(skillProjectDirectories, [
      layer('user', { 'skills.directories.project': ['.agents/skills'] }),
      layer('project', { 'skills.directories.project': ['.claude/skills'] }),
    ]);
    expect(resolved.value).toEqual(['.agents/skills', '.claude/skills']);
  });

  it('drops what a weaker scope proposed when the project declines inheritance', () => {
    const resolved = resolveSetting(skillProjectDirectories, [
      layer('user', { 'skills.directories.project': ['.agents/skills'] }),
      layer('project', { 'skills.directories.project': ['.mine/skills'] }, ['skills.directories.project']),
    ]);
    expect(resolved.value).toEqual(['.mine/skills']);
  });

  it('falls back to the key default when a decline carries no value of its own', () => {
    const resolved = resolveSetting(contextFileNames, [
      layer('user', { 'agent.contextFiles.names': ['ONLY.md'] }),
      layer('project', {}, ['agent.contextFiles.names']),
    ]);
    expect(resolved.value).toEqual(['TAGMA.md', 'AGENTS.md', 'CLAUDE.md']);
    expect(resolved.from).toBe('default');
  });

  it('skips an unreadable stored value and names the scope holding it', () => {
    const resolved = resolveSetting(contextFilesEnabled, [
      layer('user', { 'agent.contextFiles.enabled': 'yes' }),
      layer('project', { 'agent.contextFiles.enabled': false }),
    ]);
    expect(resolved.value).toBe(false);
    expect(resolved.rejections).toHaveLength(1);
    expect(resolved.rejections[0]?.scope).toBe('user');
  });

  describe('what every layer said', () => {
    it('answers each scope its own value, a decline and a writer, beside the resolved answer', () => {
      const wrote = { harness: 'tagma', key: 'agent-7' };
      const resolved = resolveSetting(contextFileNames, [
        layer('user', { 'agent.contextFiles.names': ['A.md'] }),
        {
          ...layer('project', { 'agent.contextFiles.names': ['B.md'] }),
          writers: new Map([['agent.contextFiles.names', wrote]]),
        },
      ]);
      expect(resolved.value).toEqual(['B.md']);
      expect(resolved.from).toBe('project');
      expect(resolved.layers).toEqual({
        user: { value: ['A.md'], declined: false },
        project: { value: ['B.md'], declined: false, writer: wrote },
      });
    });

    it('keeps a concatenating key apart per layer: the project layer holds its own entries alone', () => {
      const resolved = resolveSetting(skillProjectDirectories, [
        layer('user', { 'skills.directories.project': ['.agents/skills'] }),
        layer('project', { 'skills.directories.project': ['.claude/skills'] }),
      ]);
      expect(resolved.value).toEqual(['.agents/skills', '.claude/skills']);
      expect(resolved.layers.project?.value).toEqual(['.claude/skills']);
      expect(resolved.layers.user?.value).toEqual(['.agents/skills']);
    });

    it('answers a decline that carries no value as a layer with no value', () => {
      const resolved = resolveSetting(contextFileNames, [
        layer('user', { 'agent.contextFiles.names': ['ONLY.md'] }),
        layer('project', {}, ['agent.contextFiles.names']),
      ]);
      expect(resolved.from).toBe('default');
      expect(resolved.layers.project).toEqual({ declined: true });
    });

    it('answers a layer whose value did not decode with no value, and the rejection beside it', () => {
      const resolved = resolveSetting(contextFilesEnabled, [
        layer('user', { 'agent.contextFiles.enabled': 'yes' }),
        layer('project', { 'agent.contextFiles.enabled': false }),
      ]);
      expect(resolved.layers.user).toEqual({ declined: false });
      expect(resolved.layers.project).toEqual({ value: false, declined: false });
      expect(resolved.rejections[0]?.scope).toBe('user');
    });
  });

  it('ignores a scope the key does not accept', () => {
    const userOnly = settingKey({
      id: 'test.userOnly',
      order: 10,
      title: 'User only',
      description: 'A key a project may not set.',
      schema: Schema.Number,
      fallback: 1,
      scopes: ['user'],
      merge: 'replace',
    });
    const resolved = resolveSetting(userOnly, [layer('project', { 'test.userOnly': 9 })]);
    expect(resolved.value).toBe(1);
    expect(resolved.from).toBe('default');
  });

  it('reads a declaration list member by member, so one unreadable row is one rejection', () => {
    const context7 = {
      name: 'context7',
      transport: 'stdio',
      command: 'npx',
      capabilities: { kinds: ['read'], mutates: false },
      enabled: true,
    };
    const illegal = { ...context7, name: 'My__Files' };

    const resolved = resolveSetting(mcpServers, [layer('project', { 'mcp.servers': [context7, illegal] })]);
    expect(resolved.value.map((server) => server.name)).toEqual(['context7']);
    expect(resolved.from).toBe('project');
    expect(resolved.rejections).toHaveLength(1);
    expect(resolved.rejections[0]?.reason).toContain('My__Files');
    expect(resolved.rejections[0]?.scope).toBe('project');

    const chained = resolveSetting(mcpServers, [
      layer('user', { 'mcp.servers': [{ ...context7, name: 'shared' }] }),
      layer('project', { 'mcp.servers': [illegal] }),
    ]);
    expect(chained.value.map((server) => server.name)).toEqual(['shared']);
    expect(chained.rejections).toHaveLength(1);
  });

  it('a stored value that is not a list at all contributes nothing, and says so', () => {
    const resolved = resolveSetting(mcpServers, [layer('project', { 'mcp.servers': { name: 'context7' } })]);
    expect(resolved.value).toEqual([]);
    expect(resolved.from).toBe('default');
    expect(resolved.rejections).toHaveLength(1);
  });

  it('resolves a user-only budget through user scope only', () => {
    expect(resolveSetting(userBudget, [])).toEqual({ value: 5_000, from: 'default', layers: {}, rejections: [] });
    expect(resolveSetting(userBudget, [layer('user', { [userBudget.id]: 4_000 }), layer('project', { [userBudget.id]: 4_001 })])).toEqual({
      value: 4_000,
      from: 'user',
      layers: { user: { value: 4_000, declined: false } },
      rejections: [],
    });
    const rejected = resolveSetting(userBudget, [layer('user', { [userBudget.id]: 0 })]);
    expect(rejected.value).toBe(5_000);
    expect(rejected.rejections).toHaveLength(1);
  });
});
