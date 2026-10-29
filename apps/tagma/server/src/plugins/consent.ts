import type { PermissionSubject, Raised } from '@runlith/agent/permissions';
import { mcpResolvingEnvKeys } from '@runlith/mcp/declaration';
import type { PluginLoaded } from './contract/service/plugins.js';
import type { PluginConsent } from './contract/wire/consent.js';
import type { PluginComponent } from './contract/wire/rows.js';

const reachOf = (server: PluginLoaded['servers'][number]): string =>
  server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].join(' ') : server.url;

export const consentOf = (loaded: PluginLoaded): PluginConsent => {
  const subjects: PermissionSubject[] = [
    ...loaded.servers.map((server): PermissionSubject => ({
      kind: server.transport === 'stdio' ? 'execute' : 'network',
      value: reachOf(server),
    })),
    ...loaded.hooks.map((hook): PermissionSubject => ({ kind: 'execute', value: hook.label })),
  ];
  const raised: Raised[] = loaded.servers.flatMap((server) => {
    if (server.transport !== 'stdio') return [];
    const keys = mcpResolvingEnvKeys(server.env);
    return keys.length === 0
      ? []
      : [
          {
            condition: 'mcp-env-resolving',
            fact: `${server.name} sets ${keys.join(', ')}, which decide what ${server.command} resolves to and loads`,
          },
        ];
  });
  return { subjects, raised };
};

export const componentsOf = (loaded: PluginLoaded, dropped: ReadonlyMap<string, readonly string[]>): readonly PluginComponent[] => [
  ...loaded.skills.map((skill): PluginComponent => ({ kind: 'skill', name: skill.name })),
  ...loaded.commands.map((command): PluginComponent => ({ kind: 'command', name: command.name })),
  ...loaded.servers.map((server): PluginComponent => ({ kind: 'mcp-server', name: server.name, detail: reachOf(server) })),
  ...loaded.agents.map((agent): PluginComponent => {
    const lost = dropped.get(agent.name) ?? [];
    return { kind: 'agent', name: agent.name, detail: lost.length === 0 ? undefined : `no Tagma tool for ${lost.join(', ')}` };
  }),
  ...loaded.hooks.map((hook): PluginComponent => ({ kind: 'hook', name: hook.label })),
];
