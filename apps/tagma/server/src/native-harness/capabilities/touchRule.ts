import { isAbsolute, join, resolve } from 'node:path';
import { Effect } from 'effect';
import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import type { ToolShown } from '@runlith/agent/tool';
import { type TouchLedger, touchText } from '../../graph/orientation/touches.js';
import type { GraphOrigin } from '../../threads/contract/wire/target.js';
import type { InstructionSet } from '../../graph/contract/wire/instructions.js';
import type { ThreadContext } from '../turns/context.js';
import { homePlace, instructionTags } from '../turns/instructions.js';
import type { NativeRuleSource } from '../contract/service/rules.js';
import { heldCapabilities } from '../agents/capabilitySources.js';
import { instructionAudience } from '../agents/effectiveAgent.js';

const RULE_ID = 'touch';
export const touchSource: NativeRuleSource = {
  id: RULE_ID,
  create: ({ declaration, definitions }) =>
    touchRule(touchMarks(), (ctx) => {
      const held = heldCapabilities(declaration, definitions, ctx);
      return held.some((capability) => capability.id === 'files' || capability.id === 'shell') ? instructionAudience(held) : null;
    }),
};

export type TouchMarks = ReturnType<typeof touchMarks>;

export const touchMarks = () => {
  const ledgers = new Map<string, { under: string | null; ledger: TouchLedger }>();
  return {
    of: (
      thread: { readonly id: string; readonly transcript: readonly { readonly type: string; readonly id: string }[] },
      graph: GraphOrigin,
    ): TouchLedger => {
      const under = newestCompaction(thread.transcript);
      const key = `${thread.id}\u0000${graph.projectId}\u0000${graph.root}`;
      const held = ledgers.get(key);
      if (held !== undefined && held.under === under) return held.ledger;
      const ledger: TouchLedger = { delivered: new Set(), heard: new Set() };
      ledgers.set(key, { under, ledger });
      return ledger;
    },
  };
};

function newestCompaction(transcript: readonly { readonly type: string; readonly id: string }[]): string | null {
  for (let at = transcript.length - 1; at >= 0; at -= 1) {
    const entry = transcript[at];
    if (entry !== undefined && entry.type === 'compaction') return entry.id;
  }
  return null;
}

type PlacedShown = { readonly place: GraphOrigin; readonly home: boolean; readonly shown: ToolShown[] };

const placedShown = Effect.fnUntraced(function* (ctx: ThreadContext, shown: readonly ToolShown[]) {
  const home = homePlace(ctx);
  if (!ctx.world.facts.shared) return [{ place: home, home: true, shown: [...shown] }];
  const homeRoot = (yield* ctx.places.locate(home.root))?.root ?? home.root;
  const groups = new Map<string, PlacedShown>();
  for (const one of shown) {
    const path = isAbsolute(one.path) ? one.path : resolve(ctx.world.root, one.path);
    const place = yield* one.entry === true ? ctx.places.checkoutOf(path) : ctx.places.resource(path);
    if (place === null) continue;
    const own = place.projectId === home.projectId && place.root === homeRoot;
    const key = own ? '' : `${place.projectId}\u0000${place.root}`;
    const group = groups.get(key) ?? { place: own ? home : place, home: own, shown: [] };
    group.shown.push({ ...one, path: place.path });
    groups.set(key, group);
  }
  return [...groups.values()];
});

export function touchRule(
  marks: TouchMarks,
  audienceOf: (ctx: ThreadContext) => InstructionSet['audience'] | null,
): AgentRule<ThreadContext> {
  return agentRule<ThreadContext>(
    RULE_ID,
    (ctx) =>
      Effect.gen(function* () {
        if (ctx.tool === undefined || ctx.graphRoot === undefined) return null;
        const shown = ctx.tool.shown;
        if (shown === undefined || shown.length === 0) return null;
        const audience = audienceOf(ctx);
        if (audience === null) return null;
        const text = yield* Effect.gen(function* () {
          const said: string[] = [];
          for (const { place, home, shown: here } of yield* placedShown(ctx, shown)) {
            const served = home ? null : yield* Effect.result(ctx.places.graphAt(place));
            if (served?._tag === 'Failure') {
              said.push(
                `<tagma over ${place.root}>\nthe law here cannot be read now: ${served.failure.code}: ${served.failure.reason}\n</tagma>`,
              );
              continue;
            }
            const graph = served === null ? yield* ctx.graph : served.success.context;
            const briefs = yield* ctx.execution.touched(ctx, { projectId: place.projectId, graph }, here);
            const ledger = marks.of(ctx.thread, place);
            const deliveredTags = audience === 'graph' ? instructionTags(ctx.modelMessages ?? [], place.projectId) : undefined;
            for (const brief of briefs) {
              const shownAs = {
                ...brief,
                place: home ? brief.place : join(place.root, brief.place),
                tagPrompts: audience === 'graph' ? brief.tagPrompts : [],
              };
              const told = touchText(shownAs, ledger, ctx.identity, { deliveredTags });
              if (told !== null) said.push(told);
            }
          }
          return said.length === 0 ? null : said.join('\n');
        }).pipe(
          Effect.withSpan('harness.touch', {
            attributes: {
              threadId: ctx.thread.id,
              projectId: ctx.projectId,
              tool: ctx.tool.name,
              shown: shown.length,
            },
          }),
        );
        return text === null ? null : { type: 'guide' as const, text, ruleId: 'touch' };
      }),
    { owner: 'graph', hook: 'afterTool', priority: -50, critical: false },
  );
}
