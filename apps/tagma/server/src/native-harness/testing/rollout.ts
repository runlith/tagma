import { Effect } from 'effect';
import { writes } from '../../platform/contract/service/writes.js';
import type { RolloutParts } from '../../threads/journal/rolloutMeta.js';
import { makeNativeRolloutPart } from '../rollout.js';
import { makeRestedWork, RestedWork } from '../transcript/restedWork.js';

export const nativeOnlyParts = Effect.gen(function* () {
  const work = yield* makeRestedWork;
  return {
    native: yield* makeNativeRolloutPart.pipe(Effect.provideService(RestedWork, work)),
    external: {
      read: () => Effect.succeed(null),
      write: () => Effect.die(new Error('These rollout parts carry no external session.')),
      writes: writes('rollout.external', []),
    },
  } satisfies RolloutParts;
});
