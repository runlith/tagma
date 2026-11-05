import type { MarketplaceRow, TrustLabel } from '@tagma/server/marketplaces/contract/wire/rows';
import type { PluginComponent, PluginComponentKind, PluginProcessRow } from '@tagma/server/plugins/contract/wire/rows';
import type { StepTone } from './here.js';

type ProcessSaid = { readonly tone: StepTone; readonly title: string; readonly detail: string | null };

const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export function processSaid(process: PluginProcessRow, here: boolean): ProcessSaid {
  const restarted = process.restarts > 0 ? ` Restarted ${counted(process.restarts, 'time', 'times')}.` : '';
  switch (process.state) {
    case 'running':
      return {
        tone: 'done',
        title: 'Working',
        detail: here ? `Serves ${counted(process.tools, 'tool', 'tools')}.${restarted}` : `Serving your other projects.${restarted}`,
      };
    case 'idle':
      return {
        tone: 'idle',
        title: 'Asleep',
        detail: here
          ? `Offers ${counted(process.tools, 'tool', 'tools')} and wakes when an agent, a view or a schedule needs it.${restarted}`
          : `Wakes when one of your other projects needs it.${restarted}`,
      };
    case 'starting':
      return { tone: 'busy', title: 'Waking up', detail: 'It answers in a moment.' };
    case 'stopped':
      return { tone: 'idle', title: 'Stopped', detail: 'It starts by itself while a project has the plugin on.' };
    case 'failed':
      return { tone: 'fails', title: 'Broken', detail: null };
  }
}

export function failureSplit(failure: string): { readonly reason: string; readonly output: string } {
  const lines = failure.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first < 0) return { reason: '', output: '' };
  return {
    reason: lines[first]!.trim(),
    output: lines
      .slice(first + 1)
      .join('\n')
      .trim(),
  };
}

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
    case 'process':
      return { kind: 'process', title: 'A program of its own on this computer', detail: component.name };
    case 'contribution':
      return { kind: 'contribution', title: CONTRIBUTIONS[component.name] ?? `Adds ${component.name} to Tagma`, detail };
  }
}

const CONTRIBUTIONS: Readonly<Record<string, string>> = {
  tools: 'Tools agents can call',
  agents: 'Agents you can start',
  views: 'Pages inside Tagma',
  results: 'Pages that show what a tool did',
  surfaces: 'Sections in Tagma’s sidebar',
  panes: 'Panels beside a thread',
  launchers: 'Windows you open from the palette',
  pins: 'Pages a thread can keep above its feed',
  notify: 'Notifications',
  schedule: 'Runs on a schedule',
  on: 'Actions when a thread ends',
};

export const KINDS: Readonly<Record<PluginComponentKind, string>> = {
  skill: 'Skills',
  command: 'Commands',
  'mcp-server': 'MCP servers',
  agent: 'Agents',
  hook: 'Hooks',
  process: 'Programs',
  contribution: 'Additions',
};

export const FORMATS: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'agent-plugins': 'Agent Plugins',
  tagma: 'Tagma',
};

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
