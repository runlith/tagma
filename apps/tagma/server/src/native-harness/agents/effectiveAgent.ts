import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import type { EffectiveAgent } from '@runlith/agent/thread/agents/AgentDefinitions';
import { LOAD_SKILL_TOOL } from '@runlith/agent/skillWords';
import { resolveCatalog } from '@runlith/agent/catalog/resolveCatalog';
import type { CapabilityOffers, OfferFacts } from '../contract/service/execution.js';
import { capabilityInventory } from '../capabilities/inventory.js';
import type { Result } from 'effect';
import { editedPrompt, promptDocument } from './prompt.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { SectionRender } from '../../threads/doctrine/render.js';
import type { PromptDocument } from '../../threads/contract/wire/agentLibrary.js';
import type { InstructionSet } from '../../graph/contract/wire/instructions.js';
import { capabilitySections, type Capability } from '../capabilities/contract.js';

export function guidanceCapabilities(
  agentId: string,
  effective: EffectiveCapabilities,
  overlay: AgentProfile | undefined,
  offers: CapabilityOffers['Service'],
  facts: OfferFacts,
): readonly Capability[] {
  if (overlay?.tools === undefined) return effective.held;
  const selected = new Set<Capability>();
  const sources = new Map<string, Record<string, Capability[]>>();
  for (const capability of effective.held) {
    const inventory = capabilityInventory(capability, offers, facts);
    if (!inventory.complete) {
      selected.add(capability);
      continue;
    }
    for (const tool of inventory.tools) {
      const source = tool.source ?? agentId;
      const tools = sources.get(source) ?? {};
      (tools[tool.name] ??= []).push(capability);
      sources.set(source, tools);
    }
  }
  const resolved = resolveCatalog(
    { grant: effective.grant },
    { tools: overlay.tools, sources: overlay.runtimeSources },
    [...sources].map(([source, tools]) => ({ source, tools })),
  );
  for (const capabilities of Object.values(resolved.catalog)) for (const capability of capabilities) selected.add(capability);
  return effective.held.filter((capability) => selected.has(capability));
}

export type EffectiveCapabilities = EffectiveAgent<Capability>;

export function instructionAudience(capabilities: readonly Capability[]): InstructionSet['audience'] {
  return capabilities.some((capability) => capability.id === 'graph') ? 'graph' : 'executor';
}

export function canLoadSkills(effective: EffectiveCapabilities, overlay?: AgentProfile): boolean {
  const kept = overlay?.tools;
  return effective.held.some((capability) => capability.id === 'skills') && (kept === undefined || kept.includes(LOAD_SKILL_TOOL));
}

export function agentPrompt(
  agentId: string,
  effective: EffectiveCapabilities,
  enabled: (capability: Capability) => boolean,
  offers: CapabilityOffers['Service'],
  facts: OfferFacts,
  render: SectionRender,
  overlay: AgentProfile | undefined,
): Result.Result<PromptDocument, GateRefusal<'agent-invalid'>> {
  const document = promptDocument({
    agentId,
    identity: effective.identity,
    sections: new Set(
      guidanceCapabilities(agentId, effective, overlay, offers, facts)
        .filter(enabled)
        .flatMap((capability) => capabilitySections(capability, facts.world)),
    ),
    render,
  });
  return editedPrompt(document, overlay?.sections ?? [], overlay?.id ?? agentId);
}
