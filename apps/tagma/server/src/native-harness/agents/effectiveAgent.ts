import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import type { EffectiveAgent } from '@runlith/agent/thread/agents/AgentDefinitions';
import { LOAD_SKILL_TOOL } from '@runlith/agent/skillWords';
import type { Result } from 'effect';
import { editedPrompt, promptDocument } from './prompt.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { SectionRender } from '../../threads/doctrine/render.js';
import type { PromptDocument } from '../../threads/contract/wire/agentLibrary.js';
import type { InstructionSet } from '../../graph/contract/wire/instructions.js';
import { capabilitySections, type Capability } from '../capabilities/contract.js';
import type { WorldFacts } from '../../executions/contract/service/worlds.js';

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
  facts: WorldFacts,
  render: SectionRender,
  overlay: AgentProfile | undefined,
): Result.Result<PromptDocument, GateRefusal<'agent-invalid'>> {
  const document = promptDocument({
    agentId,
    identity: effective.identity,
    sections: new Set(effective.held.filter(enabled).flatMap((capability) => capabilitySections(capability, facts))),
    render,
  });
  return editedPrompt(document, overlay?.sections ?? [], overlay?.id ?? agentId);
}
