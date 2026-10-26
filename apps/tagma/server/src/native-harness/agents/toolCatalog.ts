import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import { offeredSources, resolveCatalog } from '@runlith/agent/catalog/resolveCatalog';
import { type ToolCatalog, mergeToolCatalogs } from '@runlith/agent/catalog';
import { TOOL_SEARCH_TOOL, toolSearchContribution } from '@runlith/agent/AgentDeferredTools';
import { USER_QUESTION_SOURCE, threadUserQuestionTools } from '@runlith/agent/tools/UserQuestion';
import type { CommentPolicy } from '@runlith/source-comments';
import type { AgentToolCatalog } from '../../threads/contract/wire/agentLibrary.js';
import { CHECKOUT_FACTS } from '../../executions/contract/service/worlds.js';
import { offeredWorldTools } from '../capabilities/worldTools.js';
import type { CapabilityOffers, OfferFacts } from '../contract/service/execution.js';
import type { AgentDeclaration } from './declaration.js';
import type { EffectiveCapabilities } from './effectiveAgent.js';

export const definitionFacts = (comments: CommentPolicy): OfferFacts => ({ world: CHECKOUT_FACTS, comments, images: true });

export function definitionToolCatalog(input: {
  readonly declaration: AgentDeclaration;
  readonly effective: EffectiveCapabilities;
  readonly overlay: AgentProfile | undefined;
  readonly workspace: ToolCatalog;
  readonly offers: CapabilityOffers['Service'];
  readonly comments: CommentPolicy;
}): { readonly wire: AgentToolCatalog; readonly resolved: ToolCatalog } {
  const { declaration, effective, overlay, workspace, offers, comments } = input;
  const own = mergeToolCatalogs(
    offeredWorldTools(effective.held, workspace, 'eager'),
    offeredWorldTools(effective.held, workspace, 'deferred'),
    ...effective.held.map((capability) =>
      Object.fromEntries(
        offers
          .offers(capability.id, definitionFacts(comments))
          .map((offer) => [offer.id, offer.direct ? offer.definition : { ...offer.definition, exposure: 'deferred' as const }]),
      ),
    ),
  );
  const profile = { sources: overlay?.runtimeSources, tools: overlay?.tools };
  const definition = { grant: effective.grant };
  const resolved = resolveCatalog(definition, profile, [
    { source: declaration.id, tools: own },
    { source: USER_QUESTION_SOURCE, tools: threadUserQuestionTools },
    toolSearchContribution,
  ]).catalog;
  const granted = offeredSources(definition, profile);
  const pending = new Map<string, readonly string[]>();
  const known = new Set([declaration.id, USER_QUESTION_SOURCE, ...(resolved[TOOL_SEARCH_TOOL] === undefined ? [] : [TOOL_SEARCH_TOOL])]);
  const eligible = new Set([
    ...declaration.sources,
    ...effective.sources,
    ...effective.held.flatMap((capability) => (capability.source === undefined ? [] : [capability.source.id])),
  ]);
  for (const source of granted) if (!known.has(source) && eligible.has(source)) pending.set(source, []);
  const namesOf = (source: string, names: readonly string[]) =>
    Object.keys(
      resolveCatalog(definition, profile, [
        {
          source,
          tools: Object.fromEntries(names.map((name) => [name, true])),
        },
      ]).catalog,
    );
  for (const capability of effective.held) {
    const source = capability.source;
    if (source !== undefined && granted.has(source.id)) pending.set(source.id, namesOf(source.id, source.names));
    if (capability.tools !== undefined || capability.deferredTools !== undefined) {
      const names = namesOf(declaration.id, capability.toolNames ?? []);
      if (names.length > 0) pending.set(capability.id, names);
    }
  }
  return {
    resolved,
    wire: {
      basis: 'definition',
      tools: Object.entries(resolved)
        .map(([name, tool]) => ({
          name,
          exposure: tool.exposure ?? ('eager' as const),
          schemaChars: JSON.stringify(tool.inputSchema).length,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      atBirth: [...pending].map(([source, names]) => ({ source, names })),
    },
  };
}
