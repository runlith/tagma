import { agentRule } from '@runlith/agent/AgentRuntimePolicy';
import { Schema } from 'effect';
import type { ThreadContext } from '../turns/context.js';
import type { NativeRuleSource } from '../contract/service/rules.js';
import { capabilityEnabled } from '../agents/capabilitySources.js';
import { toldState } from '../turns/guidance.js';

const RULE_ID = 'capability-cues';

const fieldOf = (input: unknown, key: string): unknown =>
  typeof input === 'object' && input !== null ? (input as Readonly<Record<string, unknown>>)[key] : undefined;

export const cueSource: NativeRuleSource = {
  id: RULE_ID,
  create: ({ declaration, definitions }) =>
    agentRule<ThreadContext>(
      RULE_ID,
      (ctx) => {
        const call = ctx.tool;
        if (call === undefined) return null;
        const cued = definitions.effective(declaration, ctx.thread.profile?.overlay).held.flatMap((capability) => {
          const { cue, guide } = capability;
          if (cue === undefined || guide === undefined || cue.tool !== call.name) return [];
          const key = `${RULE_ID}:${capability.id}`;
          if (toldState(ctx.modelMessages ?? [], key, Schema.Boolean) === true || !capabilityEnabled(capability, ctx)) return [];
          const value = fieldOf(call.input, cue.input);
          return typeof value === 'string' && new RegExp(cue.matches).test(value) ? [{ key, guide }] : [];
        });
        if (cued.length === 0) return null;
        return {
          type: 'guide',
          text: cued.map((one) => one.guide).join(' '),
          ruleId: RULE_ID,
          state: Object.fromEntries(cued.map((one) => [one.key, true])),
        };
      },
      { owner: 'native-harness', hook: 'afterTool', priority: -30, critical: false },
    ),
};
