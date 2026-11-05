import { agentRule } from '@runlith/agent/AgentRuntimePolicy';
import { Effect, Result, Schema } from 'effect';
import { changeActorOf, changedBy } from '../../platform/contract/wire/actor.js';
import type { Capability, CapabilitySettings } from './contract.js';
import type { ThreadContext } from '../turns/context.js';
import type { NativeRuleSource } from '../contract/service/rules.js';
import { toldState } from '../turns/guidance.js';
import { guidanceCapabilities } from '../agents/effectiveAgent.js';

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
const toldGates = Schema.decodeUnknownResult(
  Schema.fromJsonString(Schema.Struct({ gates: Schema.Array(Schema.Tuple([Schema.String, Schema.Boolean])) })),
);
const gatesOf = (revision: string): ReadonlyMap<string, boolean> => {
  const read = toldGates(revision);
  return Result.isSuccess(read) ? new Map(read.success.gates) : new Map();
};

export const availabilitySource: NativeRuleSource = {
  id: TOLD,
  create: ({ declaration, definitions }) => {
    const seen = new Map<string, string>();
    return agentRule<ThreadContext>(
      TOLD,
      (ctx) =>
        Effect.gen(function* () {
          if (ctx.hook !== 'beforeStep') return null;
          const settings = ctx.capabilitySettings;
          if (settings === undefined) return null;
          const current = settings.revision();
          const last = toldState(ctx.modelMessages, TOLD, codec) ?? seen.get(ctx.thread.id) ?? settings.initial;
          seen.set(ctx.thread.id, current);
          if (last === current) return null;
          const before = gatesOf(last);
          const overlay = ctx.thread.profile?.overlay;
          const parts: string[] = [];
          for (const capability of guidanceCapabilities(declaration.id, definitions.effective(declaration, overlay), overlay, ctx.offers, {
            world: ctx.world.facts,
            comments: ctx.comments(),
            images: ctx.images,
          })) {
            const notice = capability.catalog === undefined ? [] : [capability.catalog.notice(ctx)];
            if (capability.enabledBy === undefined) {
              parts.push(...notice);
              continue;
            }
            const names = ctx.offers
              .offers(capability.id, { world: ctx.world.facts, comments: ctx.comments(), images: ctx.images })
              .map((offer) => offer.id);
            const enabled = settings.enabled(capability.id);
            const was = before.get(capability.id);
            const changed =
              was === undefined || was === enabled ? undefined : (yield* ctx.settings.read(capability.enabledBy, ctx.projectId)).changed;
            const by = changed === undefined ? '' : changedBy([changeActorOf(changed.writer)], ctx.thread.id);
            const guide = enabled && capability.guide !== undefined ? ` ${capability.guide}` : '';
            parts.push(
              `${names.length === 0 ? capability.description : names.join(', ')} ${enabled ? 'are available again' : 'are no longer offered'}: ${capability.enabledBy.id} is ${enabled ? 'on' : 'off'}${by === '' ? '' : `, switched${by}`}.${guide}`,
              ...notice,
            );
          }
          return { type: 'guide' as const, text: parts.join(' '), state: { [TOLD]: current } };
        }),
      { owner: 'native-harness', hook: 'beforeStep', priority: -20 },
    );
  },
};
