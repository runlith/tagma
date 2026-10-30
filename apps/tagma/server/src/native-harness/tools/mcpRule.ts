import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import { mcpToolNamed } from '@runlith/mcp/identity';
import type { McpServers } from '../../mcp/contract/service/servers.js';

export type McpBinding = {
  readonly threadId: string;
  readonly runId: string;
  readonly projectId: number;
};

export class McpBoundTools {
  private readonly byThread = new Map<string, { readonly runId: string; readonly projects: Map<number, readonly string[]> }>();

  bound(binding: McpBinding, names: readonly string[]): readonly string[] {
    let run = this.byThread.get(binding.threadId);
    if (run?.runId !== binding.runId) {
      run = { runId: binding.runId, projects: new Map() };
      this.byThread.set(binding.threadId, run);
    }
    const previous = run.projects.get(binding.projectId);
    if (previous !== undefined) return previous;
    run.projects.set(binding.projectId, names);
    return names;
  }

  of(binding: McpBinding): readonly string[] {
    const run = this.byThread.get(binding.threadId);
    return run?.runId === binding.runId ? (run.projects.get(binding.projectId) ?? []) : [];
  }

  forget(threadId: string): void {
    this.byThread.delete(threadId);
  }
}

export type McpRuleContext = {
  readonly thread: { readonly id: string };
  readonly runId?: string | null;
  readonly projectId: number;
  readonly mcp: () => ReturnType<McpServers['Service']['palette']>;
  readonly mcpBound: McpBoundTools;
};

export function mcpRule<TContext extends McpRuleContext>(): AgentRule<TContext> {
  return agentRule<TContext>(
    'mcp',
    (ctx) => {
      if (ctx.hook !== 'beforeStep' || ctx.runId == null) return null;
      const frozen = ctx.mcpBound.of({ threadId: ctx.thread.id, projectId: ctx.projectId, runId: ctx.runId });
      if (frozen.length === 0) return null;
      const up = new Set(ctx.mcp().map((entry) => entry.declaration.name));
      const tools = frozen.filter((name) => {
        const named = mcpToolNamed(name);
        return named !== null && !up.has(named.server);
      });
      return tools.length > 0 ? { type: 'exclude', tools } : null;
    },
    { owner: 'mcp' },
  );
}
