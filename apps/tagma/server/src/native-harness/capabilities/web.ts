import { vendorWebTools } from '../tools/vendorWeb.js';
import type { CapabilityBehaviour } from './contract.js';
import { pick, worldTools } from './worldTools.js';

const WEB_TOOLS = ['webfetch', 'websearch'] as const;

export const web: CapabilityBehaviour = {
  toolNames: WEB_TOOLS,
  tools: (ctx) => {
    const egress = ctx.world.world.egress;
    return ctx.web.source === 'vendor' && egress !== undefined
      ? vendorWebTools(ctx.web, egress, pick(worldTools(ctx, { web: true }), WEB_TOOLS))
      : {};
  },
  deferredTools: (ctx) => (ctx.web.source === 'tagma' ? pick(worldTools(ctx, { web: true }), WEB_TOOLS) : {}),
};
