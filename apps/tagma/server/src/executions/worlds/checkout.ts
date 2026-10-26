import type { Commands, World } from '@runlith/agent-tools/world';
import { CHECKOUT_FACTS, CHECKOUT_WORLD_KIND, type ThreadWorld } from '../contract/service/worlds.js';

export function checkoutWorld(input: {
  readonly projectRoot: string;
  readonly scratch: string;
  readonly world: World;
  readonly commands?: Commands;
}): ThreadWorld {
  return {
    kind: CHECKOUT_WORLD_KIND,
    substrate: 'platform',
    facts: CHECKOUT_FACTS,
    world: input.commands === undefined ? input.world : { ...input.world, commands: input.commands },
    root: input.projectRoot,
    scratch: input.scratch,
    alive: () => true,
  };
}
