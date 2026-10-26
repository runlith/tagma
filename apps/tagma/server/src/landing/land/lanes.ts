import { Context, Effect, type Scope } from 'effect';
import type { Lane, LaneDeclaration } from '@runlith/held/Lane';
import { commitLane } from '../../platform/git/lanes.js';

export type CheckoutLanes = {
  readonly commits: Lane;
};

export const checkoutLanes: Effect.Effect<CheckoutLanes, never, Scope.Scope> = Effect.gen(function* () {
  return { commits: yield* commitLane };
});

const unordered = (name: string): Lane => {
  const declaration: LaneDeclaration = {
    name,
    owner: 'landing',
    rank: 0,
    threshold: '1 minute',
    ceilings: { step: '15 minutes', wait: '15 minutes', leaves: 'nothing is ordered, so a step is never cut' },
    external: 'none',
  };
  return {
    declaration,
    position: () => ({ lane: name, at: 0 }),
    enter: (_key, step) => step,
    standing: () => [],
  };
};

export const LandingLanes = Context.Reference<CheckoutLanes>('tagma/landing/LandingLanes', {
  defaultValue: () => ({ commits: unordered('git-commit') }),
});
