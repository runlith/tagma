import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { declare } from '@runlith/held/Held';
import { CEILINGS } from '../contract/service/deadlines.js';
import type { OwnGitFailed } from './ownGit.js';
import { placesOf } from './places.js';

export const indexPath = (git: Git['Service'], checkout: string): Effect.Effect<string, OwnGitFailed> =>
  Effect.map(placesOf(git, checkout), (places) => places.index);

export const indexWrites = declare<string>({
  name: 'git-index-writes',
  owner: 'platform',
  rank: 299,
  key: (index) => index,
  concurrency: 1,
  threshold: '5 seconds',
  ceilings: {
    hold: CEILINGS.callCap,
    wait: CEILINGS.callWait,
    leaves: 'git may have changed the checkout; read its state before acting again',
  },
  external: { named: 'git carrying TAGMA_OWN_GIT', callsBack: false },
});
