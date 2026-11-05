import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import { delegationNotice } from '@runlith/agent/collaboration/CollaborationVoice';
import { capabilityHolds } from '@runlith/agent/thread/agents/AgentDefinitions';
import { Effect, Schema } from 'effect';
import { toldState } from './guidance.js';
import { PEERS_CAPABILITY } from '../../threads/contract/wire/capability.js';
import type { ThreadMandate } from '../../threads/contract/service/mandate.js';
import { resolveDelegation } from '../../threads/birth/delegation.js';
import type { ThreadContext } from './context.js';
import type { NativeRuleSource } from '../contract/service/rules.js';

const TOLD = 'delegation';
export const delegationSource: NativeRuleSource = { id: TOLD, create: ({ mandate }) => delegationRule(mandate) };
const told = Schema.Struct({ allowed: Schema.Boolean });

export function delegationRule(threads: ThreadMandate['Service']): AgentRule<ThreadContext> {
  return agentRule<ThreadContext>(
    TOLD,
    (ctx) =>
      Effect.gen(function* () {
        if (ctx.hook !== 'beforeStep' || !capabilityHolds(ctx.thread.profile?.overlay, { id: PEERS_CAPABILITY })) return null;
        const current = yield* resolveDelegation(threads, ctx.settings, ctx.thread.id);
        if ((toldState(ctx.modelMessages, TOLD, told)?.allowed ?? true) === current.allowed) return null;
        return {
          type: 'guide' as const,
          text: delegationNotice(ctx.thread.id, current),
          state: { [TOLD]: { allowed: current.allowed } },
        };
      }),
    { owner: 'threads', hook: 'beforeStep', priority: -30, critical: false },
  );
}
