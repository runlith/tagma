import { isAbsolute, join, resolve } from 'node:path';
import { Context, Effect } from 'effect';
import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import type { ToolShown } from '@runlith/agent/tool';
import { type TouchLedger, touchText } from '../../graph/orientation/touches.js';
import { matchesLegacyTag, tagPromptText } from '../../graph/orientation/tagPrompts.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import type { TagTable } from '../../graph/contract/wire/tags/table.js';
import type { GraphOrigin } from '../../threads/contract/wire/target.js';
import type { Instruction, InstructionSet } from '../../graph/contract/wire/instructions.js';
import type { TagPrompt, TouchBrief } from '../../graph/contract/service/orientation.js';
import type { ThreadContext } from '../turns/context.js';
import { homePlace, instructionSnapshot, instructionTags, touchedTagsTold } from '../turns/instructions.js';
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
  const recovered = new WeakMap<TagPrompt, Set<string>>();
  return agentRule<ThreadContext>(
    RULE_ID,
    (ctx) =>
      Effect.gen(function* () {
        if (ctx.tool === undefined || ctx.graphRoot === undefined) return null;
        const shown = ctx.tool.shown;
        if (shown === undefined || shown.length === 0) return null;
        const audience = audienceOf(ctx);
        if (audience === null) return null;
        const guides = yield* Effect.gen(function* () {
          const said: string[] = [];
          const textBriefs: { brief: TouchBrief; ledger: TouchLedger }[] = [];
          const tags: { type: 'guide'; text: string; ruleId: string; batchKey: string; state: Record<string, readonly string[]> }[] = [];
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
            let previous: ReadonlyMap<string, Instruction> | undefined;
            let table: TagTable | undefined;
            for (const brief of briefs) {
              const shownAs = {
                ...brief,
                place: home ? brief.place : join(place.root, brief.place),
                tagPrompts: [],
              };
              textBriefs.push({ brief: shownAs, ledger });
              if (deliveredTags === undefined) continue;
              for (const tag of brief.tagPrompts) {
                const prompt = tagPromptText([tag], deliveredTags);
                if (prompt.text === null) continue;
                if (previous === undefined) {
                  const snapshot = instructionSnapshot(ctx.modelMessages ?? [], place.projectId);
                  previous = new Map(
                    (snapshot?.entries ?? []).flatMap((entry) => (entry.kind === 'tag' ? [[entry.source.slice(1), entry] as const] : [])),
                  );
                }
                const old = previous.get(tag.id);
                if (old !== undefined && deliveredTags.has(`${place.projectId}:${tag.id}@${old.revision}`)) {
                  let known = recovered.get(tag);
                  let matches = known?.has(old.revision) === true;
                  if (!matches) {
                    table ??= yield* Context.get(graph, Tags).of(place.projectId).pipe(Effect.provide(graph));
                    matches = matchesLegacyTag(table, tag.id, old);
                    if (matches) {
                      known ??= new Set<string>();
                      known.add(old.revision);
                      recovered.set(tag, known);
                    }
                  }
                  if (matches) {
                    deliveredTags.add(tag.identity);
                    continue;
                  }
                }
                tags.push({
                  type: 'guide',
                  text: `<tagma over ${place.root}>\n${prompt.text}\n</tagma>`,
                  ruleId: 'touch',
                  batchKey: `tag:${tag.identity}`,
                  state: { [touchedTagsTold(place.projectId)]: prompt.delivered },
                });
                deliveredTags.add(tag.identity);
              }
            }
          }
          for (const { brief, ledger } of textBriefs) {
            const told = touchText(brief, ledger, ctx.identity, {});
            if (told !== null) said.push(told);
          }
          return [...(said.length === 0 ? [] : [{ type: 'guide' as const, text: said.join('\n'), ruleId: 'touch' }]), ...tags];
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
        return guides.length === 0 ? null : guides.length === 1 ? guides[0]! : guides;
      }),
    { owner: 'graph', hook: 'afterTool', priority: -50, critical: false },
  );
}
