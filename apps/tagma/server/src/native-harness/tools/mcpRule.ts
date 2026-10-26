import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import { mcpToolNamed } from '@runlith/mcp/identity';
import type { McpServers } from '../../mcp/contract/service/servers.js';

export class McpBoundTools {
  private readonly byThread = new Map<string, readonly string[]>();

  bound(threadId: string, names: readonly string[]): void {
    if (names.length === 0) this.byThread.delete(threadId);
    else this.byThread.set(threadId, names);
  }

  of(threadId: string): readonly string[] {
    return this.byThread.get(threadId) ?? [];
  }

  forget(threadId: string): void {
    this.byThread.delete(threadId);
  }
}

export type McpRuleContext = {
  readonly thread: { readonly id: string };
  readonly mcp: () => ReturnType<McpServers['Service']['palette']>;
  readonly mcpBound: McpBoundTools;
};

export function mcpRule<TContext extends McpRuleContext>(): AgentRule<TContext> {
  return agentRule<TContext>(
    'mcp',
    (ctx) => {
      if (ctx.hook !== 'beforeStep') return null;
      const frozen = ctx.mcpBound.of(ctx.thread.id);
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
