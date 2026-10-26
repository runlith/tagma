import type { Effect, Scope } from 'effect';
import { lane, type Lane } from '@runlith/held/Lane';
import { CEILINGS } from '../contract/service/deadlines.js';

export const commitLane: Effect.Effect<Lane, never, Scope.Scope> = lane({
  name: 'git-commit',
  owner: 'platform',
  rank: 290,
  threshold: '5 seconds',
  ceilings: { step: CEILINGS.callWait, wait: CEILINGS.callWait, leaves: 'the publication is read from the recorded ref and its reflog' },
  external: { named: 'git with hooks off', callsBack: false },
});
