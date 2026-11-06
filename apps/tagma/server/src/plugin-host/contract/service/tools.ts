import type { ToolCatalog } from '@runlith/agent/catalog';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import { Context, type Effect } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { PluginsUnreadable } from '../../../plugins/contract/service/plugins.js';
import type { PluginContribution } from '../../../plugins/contract/service/points.js';
import { ToolEntries } from '../wire/audience.js';

export const TOOLS = new ContributionPoint<never, ToolEntries>('plugin-host/tools', {
  name: 'tools',
  title: 'Tools agents can call',
  schema: ToolEntries,
});

export const unservedTools = (sibling: PluginContribution<unknown>['sibling'], tools: readonly string[]): string | null => {
  const declared = new Map((sibling(TOOLS) ?? []).map((entry) => [entry.name, entry.audience]));
  for (const tool of tools) {
    const audience = declared.get(tool);
    if (audience === undefined) return `contributes.tools names no tool ${tool}`;
    if (audience !== 'tagma') return `the tool ${tool} is offered to ${audience}, and a point calls only a tool whose audience is tagma`;
  }
  return null;
};

export type ProjectTools = {
  agents(): ToolCatalog;
  own(plugin: string): ToolCatalog;
  view(plugin: string): readonly McpToolDescriptor[];
};

export class PluginTools extends Context.Service<
  PluginTools,
  {
    of(projectId: number): Effect.Effect<ProjectTools, PluginsUnreadable>;
  }
>()('tagma/plugin-host/PluginTools') {}
