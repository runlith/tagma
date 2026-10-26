import { Effect } from 'effect';
import { writes } from '../../platform/contract/service/writes.js';
import type { RolloutParts } from '../../threads/journal/rolloutMeta.js';
import { nativeRolloutPart } from '../rollout.js';

export const nativeOnlyParts: RolloutParts = {
  native: nativeRolloutPart,
  external: {
    read: () => Effect.succeed(null),
    write: () => Effect.die(new Error('These rollout parts carry no external session.')),
    writes: writes('rollout.external', []),
  },
};
