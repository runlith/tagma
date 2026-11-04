import type { CapabilityOffers, OfferFacts } from '../contract/service/execution.js';
import type { Capability } from './contract.js';

export type CapabilityTool = {
  readonly name: string;
  readonly description: string;
  readonly source?: string;
};

export type CapabilityInventory = {
  readonly tools: readonly CapabilityTool[];
  readonly complete: boolean;
};

export function capabilityInventory(
  capability: Capability,
  offers: CapabilityOffers['Service'],
  facts: OfferFacts | 'any-world',
): CapabilityInventory {
  const tools = new Map<string, CapabilityTool>();
  const add = (tool: CapabilityTool) => tools.set(`${tool.source ?? ''}\u0000${tool.name}`, tool);
  for (const name of new Set([...(capability.toolNames ?? []), ...Object.keys(capability.workspaceTools ?? {})]))
    add({ name, description: capability.description });
  const source = capability.source;
  if (source !== undefined) for (const name of source.names) add({ name, description: capability.description, source: source.id });
  for (const offer of facts === 'any-world' ? offers.everywhere(capability.id) : offers.offers(capability.id, facts))
    add({ name: offer.id, description: offer.meaning });
  return {
    tools: [...tools.values()],
    complete: (capability.runtimeSources?.length ?? 0) === 0 && (capability.source === undefined || capability.source.names.length > 0),
  };
}
