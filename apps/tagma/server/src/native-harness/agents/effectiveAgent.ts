import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import type { EffectiveAgent } from '@runlith/agent/thread/agents/AgentDefinitions';
import { LOAD_SKILL_TOOL } from '@runlith/agent/skillWords';
import { resolveCatalog } from '@runlith/agent/catalog/resolveCatalog';
import type { CapabilityOffers, OfferFacts } from '../contract/service/execution.js';
import { capabilityInventory } from '../capabilities/inventory.js';
import { TOOL_SEARCH_TOOL } from '@runlith/agent/AgentDeferredTools';
import { threadUserQuestionTools } from '@runlith/agent/tools/UserQuestion';
import { Result } from 'effect';
import { RETRIEVAL_TOOL } from '../tools/outputWords.js';
import { conversationSources } from './conversationSources.js';
import { editedPrompt, promptDocument } from './prompt.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
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

const CONVERSATION_TOOLS: ReadonlySet<string> = new Set([...Object.keys(threadUserQuestionTools), TOOL_SEARCH_TOOL, RETRIEVAL_TOOL]);
const CONVERSATION_SOURCES: ReadonlySet<string> = new Set(conversationSources);

const TOOLS_WAYS: Unblock = [
  'Add the capability that offers each named tool to the definition’s capabilities, or drop the name from tools; read_agent_library lists every capability with its tools.',
  'Refresh the thread’s instructions after correcting its definition; its next run adopts the corrected tools.',
];

function unofferedTools(
  effective: EffectiveCapabilities,
  overlay: AgentProfile | undefined,
  registered: readonly Capability[],
  offers: CapabilityOffers['Service'],
): ReadonlyMap<string, readonly string[]> {
  const unoffered = new Map<string, readonly string[]>();
  if (overlay?.tools === undefined || overlay.capabilities === undefined) return unoffered;
  if (effective.grant.sources.some((entry) => entry.standing === true && !CONVERSATION_SOURCES.has(entry.source))) return unoffered;
  const offered = new Set(CONVERSATION_TOOLS);
  for (const capability of effective.held) {
    const inventory = capabilityInventory(capability, offers, 'any-world');
    if (!inventory.complete) return unoffered;
    for (const tool of inventory.tools) offered.add(tool.name);
  }
  const others = registered
    .filter((capability) => !effective.held.includes(capability))
    .map((capability) => ({ id: capability.id, ...capabilityInventory(capability, offers, 'any-world') }));
  for (const name of overlay.tools) {
    if (offered.has(name)) continue;
    const offering = others.filter((other) => other.tools.some((tool) => tool.name === name)).map((other) => other.id);
    unoffered.set(name, offering);
  }
  return unoffered;
}

function unofferedRefusal(unoffered: ReadonlyMap<string, readonly string[]>, origin: string): GateRefusal<'agent-invalid'> | undefined {
  if (unoffered.size === 0) return undefined;
  const groups = new Map<string, string[]>();
  for (const [name, offering] of unoffered) {
    const key = offering.length > 0 ? `add ${offering.join(' or ')}` : 'no capability offers it';
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  const named = [...groups].map(([key, names]) => `${names.join(', ')}: ${key}`).join('; ');
  return new GateRefusal(
    'agent-invalid',
    `tools of ${origin} name ${unoffered.size === 1 ? 'a tool' : 'tools'} that no capability it holds offers, so the thread would start without ${unoffered.size === 1 ? 'it' : 'them'} (${named})`,
    TOOLS_WAYS,
  );
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
  registered: readonly Capability[],
  enabled: (capability: Capability) => boolean,
  offers: CapabilityOffers['Service'],
  facts: OfferFacts,
  render: SectionRender,
  overlay: AgentProfile | undefined,
): Result.Result<PromptDocument, GateRefusal<'agent-invalid'>> {
  const refusal = unofferedRefusal(unofferedTools(effective, overlay, registered, offers), overlay?.id ?? agentId);
  if (refusal !== undefined) return Result.fail(refusal);
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
