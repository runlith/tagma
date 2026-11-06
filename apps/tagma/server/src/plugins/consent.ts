import { join } from 'node:path';
import type { PermissionSubject, Raised } from '@runlith/agent/permissions';
import { mcpResolvingEnvKeys } from '@runlith/mcp/declaration';
import { mcpRedactor } from '@runlith/mcp/mcpRedactor';
import type { PluginLoaded } from './contract/service/plugins.js';
import type { PluginPoints } from './contract/service/points.js';
import type { PluginConsent } from './contract/wire/consent.js';
import type { PluginComponent } from './contract/wire/rows.js';

const reachOf = (server: PluginLoaded['servers'][number]): string =>
  server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].join(' ') : server.url;

const maskOf = (loaded: PluginLoaded): ((text: string) => string) =>
  loaded.redact.length === 0 ? (text) => text : mcpRedactor([...loaded.redact]);

export const consentOf = (loaded: PluginLoaded): PluginConsent => {
  const mask = maskOf(loaded);
  const subjects: PermissionSubject[] = [
    ...(loaded.process === null
      ? []
      : [{ kind: 'execute', value: mask(join(loaded.place.root, loaded.process.entry)) } satisfies PermissionSubject]),
    ...loaded.servers.map((server): PermissionSubject => ({
      kind: server.transport === 'stdio' ? 'execute' : 'network',
      value: mask(reachOf(server)),
    })),
    ...loaded.hooks.map((hook): PermissionSubject => ({ kind: 'execute', value: mask(hook.label) })),
  ];
  const raised: Raised[] = loaded.servers.flatMap((server) => {
    if (server.transport !== 'stdio') return [];
    const keys = mcpResolvingEnvKeys(server.env);
    return keys.length === 0
      ? []
      : [
          {
            condition: 'mcp-env-resolving',
            fact: `${server.name} sets ${keys.join(', ')}, which decide what ${mask(server.command)} resolves to and loads`,
          },
        ];
  });
  return { subjects, raised };
};

const contributionComponent = (points: PluginPoints['Service'], point: string, value: unknown): PluginComponent => {
  const entries = points.entries(point, value);
  return { kind: 'contribution', name: point, title: points.title(point), ...(entries.length === 0 ? {} : { entries }) };
};

export const componentsOf = (
  loaded: PluginLoaded,
  dropped: ReadonlyMap<string, readonly string[]>,
  points: PluginPoints['Service'],
): readonly PluginComponent[] => {
  const mask = maskOf(loaded);
  return [
    ...(loaded.process === null ? [] : [{ kind: 'process', name: loaded.process.entry } satisfies PluginComponent]),
    ...Object.entries(loaded.contributes).map(([point, value]) => contributionComponent(points, point, value)),
    ...loaded.skills.map((skill): PluginComponent => ({ kind: 'skill', name: skill.name })),
    ...loaded.commands.map((command): PluginComponent => ({ kind: 'command', name: command.name })),
    ...loaded.servers.map((server): PluginComponent => ({ kind: 'mcp-server', name: server.name, detail: mask(reachOf(server)) })),
    ...loaded.agents.map((agent): PluginComponent => {
      const lost = dropped.get(agent.name) ?? [];
      return { kind: 'agent', name: agent.name, detail: lost.length === 0 ? undefined : `no Tagma tool for ${lost.join(', ')}` };
    }),
    ...loaded.hooks.map((hook): PluginComponent => ({ kind: 'hook', name: mask(hook.label) })),
  ];
};
