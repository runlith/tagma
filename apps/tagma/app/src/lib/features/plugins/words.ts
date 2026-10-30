import type { MarketplaceRow, TrustLabel } from '@tagma/server/marketplaces/contract/wire/rows';
import type { PluginComponent, PluginComponentKind } from '@tagma/server/plugins/contract/wire/rows';

export type ComponentSaid = { readonly kind: PluginComponentKind | 'program'; readonly title: string; readonly detail: string | null };

const hostOf = (address: string): string | null => (URL.canParse(address) ? new URL(address).host : null);

export function saidOf(component: PluginComponent): ComponentSaid {
  const detail = component.detail ?? null;
  switch (component.kind) {
    case 'mcp-server': {
      const host = detail === null ? null : hostOf(detail);
      return host === null
        ? { kind: 'program', title: `A program on this computer, ${component.name}`, detail }
        : { kind: 'mcp-server', title: `A connection to ${host}`, detail };
    }
    case 'skill':
      return { kind: 'skill', title: `The skill $${component.name}`, detail };
    case 'command':
      return { kind: 'command', title: `The command $${component.name}`, detail };
    case 'agent':
      return {
        kind: 'agent',
        title: `The agent ${component.name}`,
        detail: detail === null ? null : `Names tools Tagma has none of: ${detail}`,
      };
    case 'hook':
      return { kind: 'hook', title: `Runs on ${component.name}`, detail };
  }
}

export const KINDS: Readonly<Record<PluginComponentKind, string>> = {
  skill: 'Skills',
  command: 'Commands',
  'mcp-server': 'MCP servers',
  agent: 'Agents',
  hook: 'Hooks',
};

export const FORMATS: Readonly<Record<string, string>> = { 'claude-code': 'Claude Code', codex: 'Codex', 'agent-plugins': 'Agent Plugins' };

export const LABELS: Readonly<Record<TrustLabel, string>> = { tagma: 'Tagma', vendor: 'Vendor', unreviewed: 'Unreviewed' };

const repositoryOf = (url: string): string => {
  const parts = url
    .replace(/\.git$/u, '')
    .split(/[/:]/u)
    .filter((part) => part !== '');
  return parts.slice(-2).join('/');
};

export function originOf(marketplace: MarketplaceRow): string {
  if (marketplace.label === 'tagma') return 'Tagma';
  if (marketplace.label === 'vendor') return marketplace.title;
  return marketplace.source.kind === 'git' ? repositoryOf(marketplace.source.url) : (marketplace.source.path.split('/').at(-1) ?? '');
}
