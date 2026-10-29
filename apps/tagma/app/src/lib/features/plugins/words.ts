import type { MarketplaceRow, TrustLabel } from '@tagma/server/marketplaces/contract/wire/rows';
import type { PluginComponentKind } from '@tagma/server/plugins/contract/wire/rows';

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
