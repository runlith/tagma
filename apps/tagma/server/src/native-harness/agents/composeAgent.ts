import { Agent } from '@runlith/agent/Agent';
import type { AgentAsideHook } from '@runlith/agent/AgentAside';
import type { AgentRuleRegistry, AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import type { RuleSetup } from '../contract/service/rules.js';
import type { AgentRunner } from '@runlith/agent/AgentRunner';
import type { CallHooks } from '@runlith/agent/AgentCalls';
import { type ToolCatalog, mergeToolCatalogs } from '@runlith/agent/catalog';
import { deferredToolsSection, revealedDefinitionsSection } from '@runlith/agent/AgentDeferredTools';
import { stepLimit } from '@runlith/agent/AgentStep';
import { threadAgent, type ThreadAgent, type ThreadContextUse, type ThreadView } from '@runlith/agent/thread/agents/ThreadAgent';
import type { ThreadAsides } from '@runlith/agent/thread/ThreadAsides';
import { Effect, Result } from 'effect';
import { nativeTurnContext } from '../turns/message.js';
import { agentPrompt, instructionAudience } from './effectiveAgent.js';
import { capabilityLossSection } from './capabilityLoss.js';
import { capabilityEnabled, heldCapabilities } from './capabilitySources.js';
import type { Capability } from '../capabilities/contract.js';
import { readCapabilitySettings } from '../capabilities/availability.js';
import { offeredWorldTools, worldTools } from '../capabilities/worldTools.js';
import type { CapabilityDefinitions } from '../capabilities/definitions.js';
import type { AgentDeclaration } from './declaration.js';
import type { NativeThreadRows } from '../rows/native.js';
import type { ThreadMandate } from '../../threads/contract/service/mandate.js';
import type { ThreadContext, ThreadContextFailure } from '../turns/context.js';
import type { ThreadTeams } from '../../threads/contract/service/team.js';
import { writtenOfThread } from '../../change-record/record/reads.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import type { SectionCatalog } from '../../platform/contract/service/sections.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';

const STEP_LIMIT = 1000;

export function composeAgent(
  rules: AgentRuleRegistry<ThreadContext, RuleSetup>,
  declaration: AgentDeclaration,
  definitions: CapabilityDefinitions,
  runner: AgentRunner,
  rows: NativeThreadRows,
  mandate: ThreadMandate['Service'],
  teams: ThreadTeams['Service'],
  context: (thread: ThreadView, use: ThreadContextUse) => Effect.Effect<ThreadContext, ThreadContextFailure>,
  sections?: SectionCatalog | null,
  asides?: ThreadAsides,
  aside?: (projectId: number, threadId: string) => Effect.Effect<AgentAsideHook | null>,
  callHooks?: (ctx: ThreadContext) => CallHooks,
  contributed?: readonly AgentRule<ThreadContext>[],
): ThreadAgent<WriteUnit<'machine'>> {
  const setup: RuleSetup = { declaration, definitions, mandate, teams };
  const held = (ctx: ThreadContext): readonly Capability[] => heldCapabilities(declaration, definitions, ctx);
  return threadAgent<ThreadContext, ThreadContextFailure, WriteUnit<'machine'>>({
    agent: composed(setup, held, sections ?? null, contributed ?? [], rules),
    runner,
    callHooks,
    hostedWeb: (ctx) => (ctx.web.source === 'hosted' && held(ctx).some((capability) => capability.id === 'web') ? 'vendor' : 'none'),
    runPolicy: declaration.runPolicy ?? { userStartable: true, backgroundStartable: false },
    catalogRevision: (ctx) => ctx.capabilitySettings?.revision() ?? '',
    context: (thread, use) =>
      Effect.flatMap(context(thread, use), (ctx) =>
        Effect.gen(function* () {
          const capabilities = definitions.effective(declaration, ctx.thread.profile?.overlay).held;
          const capabilitySettings = yield* readCapabilitySettings(capabilities, ctx);
          const answers = yield* Effect.forEach(
            capabilities.filter((capability) => capabilitySettings.enabled(capability.id)),
            (capability) => Effect.result(capability.prepare?.(ctx) ?? Effect.void),
          );
          return {
            ...ctx,
            capabilitySettings,
            unavailableCapabilities: answers.flatMap((answer) => (answer._tag === 'Failure' ? [answer.failure] : [])),
          };
        }),
      ),
    aside: aside ? (ctx: ThreadContext, input: { thread: ThreadView }) => aside(ctx.projectId, input.thread.id) : undefined,
    asides,
    turnContext: Effect.fnUntraced(function* (ctx, input) {
      const holding = held(ctx);
      return yield* nativeTurnContext({
        threads: rows,
        graph: yield* ctx.graph,
        threadId: ctx.thread.id,
        runId: input.run.id,
        history: input.thread.history,
        sections: [
          ...holding.flatMap((capability) => capability.turnNote?.(ctx) ?? []),
          deferredToolsSection(input.catalog),
          ...(ctx.thread.capabilities.toolCatalog === 'dispatch' ? [revealedDefinitionsSection(input.catalog, input.thread.history)] : []),
          capabilityLossSection(ctx.unavailableCapabilities, (id) => definitions.find(id)?.description ?? id),
        ],
        digest: instructionAudience(holding, ctx.thread.profile?.overlay) === 'graph',
        session: { harness: NATIVE_HARNESS, key: ctx.thread.id },
        written: Effect.map(writtenOfThread(ctx.units, ctx.machine, ctx.projectId, ctx.thread.id), (places) => [
          ...new Set(places.map((place) => place.path)),
        ]),
      });
    }),
  });
}

function workspaceCatalog(held: readonly Capability[], ctx: ThreadContext): ToolCatalog {
  return held.some((capability) => capability.workspaceTools !== undefined) ? worldTools(ctx, { web: false }) : {};
}

function agentTools(held: readonly Capability[], ctx: ThreadContext): ToolCatalog {
  const workspace = workspaceCatalog(held, ctx);
  return mergeToolCatalogs(
    offeredWorldTools(held, workspace, 'eager'),
    ...held.flatMap((capability) => (capability.tools ? [capability.tools(ctx)] : [])),
    ctx.execution.tools(ctx, mounted(held, ctx, true)),
    deferredAgentTools(held, ctx, workspace),
  );
}

function deferredAgentTools(held: readonly Capability[], ctx: ThreadContext, workspace: ToolCatalog): ToolCatalog {
  const deferred = mergeToolCatalogs(
    offeredWorldTools(held, workspace, 'deferred'),
    ...held.flatMap((capability) => (capability.deferredTools ? [capability.deferredTools(ctx)] : [])),
    ctx.execution.tools(ctx, mounted(held, ctx, false)),
  );
  const exposure = ctx.thread.capabilities.toolCatalog === 'turn' ? undefined : ('deferred' as const);
  return Object.fromEntries(Object.entries(deferred).map(([name, tool]) => [name, { ...tool, exposure }]));
}

function mounted(held: readonly Capability[], ctx: ThreadContext, direct: boolean): readonly string[] {
  return held.flatMap((capability) =>
    ctx.offers
      .offers(capability.id, { world: ctx.world.facts, comments: ctx.comments(), images: ctx.images })
      .filter((offered) => offered.direct === direct)
      .map((offered) => offered.id),
  );
}

function composed(
  setup: RuleSetup,
  held: (ctx: ThreadContext) => readonly Capability[],
  sections: SectionCatalog | null,
  contributed: readonly AgentRule<ThreadContext>[],
  rules: AgentRuleRegistry<ThreadContext, RuleSetup>,
): Agent<ThreadContext> {
  const { declaration, definitions } = setup;
  return new Agent<ThreadContext>({
    id: declaration.id,
    name: declaration.name,
    description: declaration.description,
    standing: () => {
      const standing = definitions.effective(declaration);
      return {
        grant: standing.grant,
        rules: [...contributed, ...rules.rules(setup), ...definitions.rules(declaration, (ctx) => ctx.thread.profile?.overlay)],
      };
    },
    instructions: (ctx) => {
      const overlay = ctx.thread.profile?.overlay;
      const document = agentPrompt(
        declaration.id,
        definitions.effective(declaration, overlay),
        definitions.list(),
        (capability) => capabilityEnabled(capability, ctx),
        ctx.offers,
        { world: ctx.world.facts, comments: ctx.comments(), images: ctx.images },
        {
          checkout: ctx.checkout,
          autoCommit: ctx.autoCommit,
          comments: ctx.comments(),
          facts: ctx.facts,
          graphOverCode: ctx.vocabulary().bindsCode(),
          contributed: sections,
          world: {
            root: ctx.world.root,
            shell: ctx.world.world.environment.shell,
            platform: ctx.world.world.environment.platform,
          },
        },
        overlay,
      );
      if (Result.isFailure(document)) throw document.failure;
      return document.success.text;
    },
    tools: (ctx) => agentTools(held(ctx), ctx),
    stopWhen: [stepLimit(STEP_LIMIT)],
    compaction: declaration.compaction,
  });
}
