import type { CapabilityBehaviour } from './contract.js';

export const tagmaApps: CapabilityBehaviour = {
  source: { id: 'apps', names: [], tools: (ctx) => ctx.tagmaApps.agents() },
};
