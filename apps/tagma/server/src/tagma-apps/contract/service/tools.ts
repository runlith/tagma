import type { ToolCatalog } from '@runlith/agent/catalog';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export type ProjectTools = {
  agents(): ToolCatalog;
  own(app: string): ToolCatalog;
  view(app: string): readonly McpToolDescriptor[];
};

export class TagmaAppTools extends Context.Service<
  TagmaAppTools,
  {
    of(projectId: number): Effect.Effect<ProjectTools, StoreFailure>;
  }
>()('tagma/tagma-apps/TagmaAppTools') {}
