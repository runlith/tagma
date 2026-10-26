import type { ToolCatalog } from '@runlith/agent/catalog';
import type { WebSearchSessions } from './WebSearchSessions';
import type { Egress } from './world';
import { createWebfetchTool } from './webfetch';
import { createWebsearchTool } from './websearch';

export type AgentWebToolContext = {
  readonly modelName?: string | null;
  readonly sessions: WebSearchSessions;
  readonly egress: Egress;
};

export function agentWebTools(context: AgentWebToolContext): ToolCatalog {
  return {
    webfetch: createWebfetchTool({ egress: context.egress }),
    websearch: createWebsearchTool({
      egress: context.egress,
      websearch: {
        modelName: context.modelName ?? undefined,
        sessions: context.sessions,
      },
    }),
  };
}
