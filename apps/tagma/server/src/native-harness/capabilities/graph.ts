import { Effect } from 'effect';
import { CapabilityUnavailable, type CapabilityBehaviour } from './contract.js';

export const graph: CapabilityBehaviour = {
  prepare: (ctx) =>
    ctx.graphRefused === undefined
      ? Effect.void
      : Effect.fail(
          new CapabilityUnavailable({
            capability: 'graph',
            reason: `the project's graph did not open — ${ctx.graphRefused.message}; way out: ${ctx.graphRefused.unblock.join('; ')}`,
          }),
        ),
};
