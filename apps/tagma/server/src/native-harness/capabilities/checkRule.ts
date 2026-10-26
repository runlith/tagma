import { Effect } from 'effect';
import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import type { ThreadContext } from '../turns/context.js';
import type { NativeRuleSource } from '../contract/service/rules.js';

const RULE_ID = 'rule-checks';
export const checkSource: NativeRuleSource = { id: RULE_ID, create: () => checkRule() };

export function checkRule(): AgentRule<ThreadContext> {
  return agentRule<ThreadContext>(
    RULE_ID,
    (ctx) =>
      Effect.gen(function* () {
        if (ctx.tool === undefined) return null;
        yield* ctx.execution.afterEdit(ctx, { name: ctx.tool.name, input: ctx.tool.input, shown: ctx.tool.shown ?? [] });
        return null;
      }),
    { owner: 'enforcement', hook: 'afterTool', priority: -10, critical: false },
  );
}
