import type { ToolCatalog } from '@runlith/agent/catalog';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import { Context, type Effect } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { PluginsUnreadable } from '../../../plugins/contract/service/plugins.js';
import { ToolEntries } from '../wire/audience.js';

export const TOOLS = new ContributionPoint<never, ToolEntries>('plugin-host/tools', { name: 'tools', schema: ToolEntries });

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
