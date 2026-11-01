import type { ToolCatalog } from '@runlith/agent/catalog';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import { Context, type Effect } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import { ToolEntries } from '../wire/audience.js';

export const TOOLS = new ContributionPoint<never, ToolEntries>('tagma-apps/tools', { name: 'tools', schema: ToolEntries });

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
