import { section } from '@runlith/held/Section';
import { CEILINGS } from '../../platform/contract/service/deadlines.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { FinishingGate } from '../contract/service/retirement.js';
import { finishingSection } from './finishing.js';

export const makeFinishingGates = (): FinishingGate['Service'] => {
  const roots = section<RootId>({
    name: 'worktree-root',
    owner: 'worktrees',
    rank: 160,
    key: (rootId) => rootId,
    threshold: '5 minutes',
    ceilings: {
      hold: CEILINGS.callCap,
      wait: CEILINGS.callCap,
      leaves:
        'a cut finishing act stops where it stood; a deletion resumes from its recorded intent, and a merge left open in the base checkout is ended with abort_checkout',
    },
    external: 'none',
  });
  const checkouts = section<string>({
    name: 'worktree-checkout',
    owner: 'worktrees',
    rank: 170,
    key: (path) => path,
    threshold: '5 minutes',
    ceilings: {
      hold: CEILINGS.callCap,
      wait: CEILINGS.callCap,
      leaves: 'a cut merge may leave the base checkout mid-merge; abort_checkout ends it',
    },
    external: 'none',
  });
  return {
    hold: (key, work) => finishingSection(key.kind === 'root' ? roots.enter(key.rootId, work) : checkouts.enter(key.path, work)),
  };
};
