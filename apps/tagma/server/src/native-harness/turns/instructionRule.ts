import { Context, Effect } from 'effect';
import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import { Orientation } from '../../graph/contract/service/orientation.js';
import { instructionText } from '../../graph/orientation/Instructions.js';
import type { InstructionSet } from '../../graph/contract/wire/instructions.js';
import type { GraphServices } from '../../graph/contract/service/services.js';
import type { GraphStore } from '../../platform/contract/service/store.js';
import type { ThreadContext } from './context.js';
import { instructionSnapshot, instructionsTold } from './instructions.js';
import type { NativeRuleSource } from '../contract/service/rules.js';
import { heldCapabilities } from '../agents/capabilitySources.js';
import { instructionAudience } from '../agents/effectiveAgent.js';

const RULE_ID = 'project-instructions';
export const instructionSource: NativeRuleSource = {
  id: RULE_ID,
  create: ({ declaration, definitions }) => instructionRule((ctx) => instructionAudience(heldCapabilities(declaration, definitions, ctx))),
};

export function instructionRule(audienceOf: (ctx: ThreadContext) => InstructionSet['audience']): AgentRule<ThreadContext> {
  return agentRule<ThreadContext>(
    RULE_ID,
    (ctx) =>
      Effect.gen(function* () {
        if (ctx.hook !== 'beforeStep' || ctx.graphRefused !== undefined) return null;
        const audience = audienceOf(ctx);
        const told: string[] = [];
        const state: Record<string, InstructionSet> = {};
        const deliver = Effect.fnUntraced(function* (projectId: number, graph: Context.Context<GraphServices | GraphStore>) {
          const previous = instructionSnapshot(ctx.modelMessages, projectId);
          const current = yield* Context.get(graph, Orientation).instructions({ projectId, audience }).pipe(Effect.provide(graph));
          const text = instructionText(current, previous);
          if (text.length === 0) return;
          told.push(text);
          state[instructionsTold(projectId)] = current;
        });
        yield* deliver(ctx.projectId, yield* ctx.graph);
        for (const place of yield* ctx.places.held(ctx.thread.id)) {
          if (place.projectId === ctx.projectId) continue;
          const served = yield* Effect.result(ctx.places.graphAt(place));
          if (served._tag === 'Success') {
            yield* deliver(place.projectId, served.success.context);
            continue;
          }
          yield* ctx.places.leave(ctx.thread.id, place.projectId);
          told.push(
            `The law of project ${place.projectId} (${place.root}) cannot be read now: ${served.failure.code}: ${served.failure.reason}. The next change there is held again until its law arrives.`,
          );
        }
        return told.length === 0 ? null : { type: 'guide' as const, text: told.join('\n\n'), state };
      }),
    { owner: 'graph', hook: 'beforeStep', priority: -60, critical: true },
  );
}
