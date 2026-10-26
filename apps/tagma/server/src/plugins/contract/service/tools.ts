import type { ToolCatalog } from '@runlith/agent/catalog';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export type ProjectTools = {
  agents(): ToolCatalog;
  own(plugin: string): ToolCatalog;
  view(plugin: string): readonly McpToolDescriptor[];
};

export class PluginTools extends Context.Service<
  PluginTools,
  {
    of(projectId: number): Effect.Effect<ProjectTools, StoreFailure>;
  }
>()('tagma/plugins/PluginTools') {}
