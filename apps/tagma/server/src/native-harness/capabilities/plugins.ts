import type { CapabilityBehaviour } from './contract.js';

export const plugins: CapabilityBehaviour = {
  source: { id: 'plugins', names: [], tools: (ctx) => ctx.pluginTools.agents() },
};
