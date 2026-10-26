import { Effect } from 'effect';
import { mcpRule } from '../tools/mcpRule.js';
import { mcpServerTools } from '../tools/mcpServers.js';
import type { ThreadContext } from '../turns/context.js';
import { CapabilityUnavailable, type CapabilityBehaviour } from './contract.js';

const quoted = (value: string): string => JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value);

export const mcp: CapabilityBehaviour = {
  source: {
    id: 'mcp',
    names: [],
    tools: (ctx) =>
      Object.fromEntries(Object.entries(mcpServerTools(ctx)).map(([name, tool]) => [name, { ...tool, exposure: 'deferred' as const }])),
  },
  rules: [mcpRule<ThreadContext>()],
  prepare: (ctx) =>
    ctx.mcpServers.reconcile(ctx.projectId).pipe(
      Effect.mapError(
        (failure) =>
          new CapabilityUnavailable({
            capability: 'mcp',
            reason: `the MCP pool did not reconcile: ${quoted(failure.message.split('\n')[0] ?? failure.message)}`,
          }),
      ),
    ),
};
