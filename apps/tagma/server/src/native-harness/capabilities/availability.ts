import { agentRule } from '@runlith/agent/AgentRuntimePolicy';
import { Effect, Schema } from 'effect';
import type { Capability, CapabilitySettings } from './contract.js';
import type { ThreadContext } from '../turns/context.js';
import type { NativeRuleSource } from '../contract/service/rules.js';
import { toldState } from '../turns/guidance.js';

export const readCapabilitySettings = Effect.fnUntraced(function* (capabilities: readonly Capability[], ctx: ThreadContext) {
  const gates = new Map<string, () => boolean>();
  for (const capability of capabilities) {
    if (capability.enabledBy !== undefined) gates.set(capability.id, yield* ctx.settings.held(capability.enabledBy, ctx.projectId));
  }
  const revision = () =>
    JSON.stringify({
      gates: [...gates].map(([id, enabled]) => [id, enabled()]),
      catalogs: capabilities.flatMap((capability) =>
        capability.catalog === undefined ? [] : [[capability.id, capability.catalog.revision(ctx)]],
      ),
    });
  return { enabled: (id) => gates.get(id)?.() ?? true, revision, initial: revision() } satisfies CapabilitySettings;
});

const TOLD = 'capability-settings';
const codec = Schema.String;

export const availabilitySource: NativeRuleSource = {
  id: TOLD,
  create: ({ declaration, definitions }) => {
    const seen = new Map<string, string>();
    return agentRule<ThreadContext>(
      TOLD,
      (ctx) => {
        if (ctx.hook !== 'beforeStep') return null;
        const settings = ctx.capabilitySettings;
        if (settings === undefined) return null;
        const current = settings.revision();
        const last = toldState(ctx.modelMessages, TOLD, codec) ?? seen.get(ctx.thread.id) ?? settings.initial;
        seen.set(ctx.thread.id, current);
        if (last === current) return null;
        const text = definitions
          .effective(declaration, ctx.thread.profile?.overlay)
          .held.flatMap((capability) => {
            const notice = capability.catalog === undefined ? [] : [capability.catalog.notice(ctx)];
            if (capability.enabledBy === undefined) return notice;
            const names = ctx.offers
              .offers(capability.id, { world: ctx.world.facts, comments: ctx.comments(), images: ctx.images })
              .map((offer) => offer.id);
            const enabled = settings.enabled(capability.id);
            const guide = enabled && capability.guide !== undefined ? ` ${capability.guide}` : '';
            return [
              `${names.length === 0 ? capability.description : names.join(', ')} ${enabled ? 'are available again' : 'are no longer offered'}: ${capability.enabledBy.id} is ${enabled ? 'on' : 'off'}.${guide}`,
              ...notice,
            ];
          })
          .join(' ');
        return { type: 'guide', text, state: { [TOLD]: current } };
      },
      { owner: 'native-harness', hook: 'beforeStep', priority: -20 },
    );
  },
};
