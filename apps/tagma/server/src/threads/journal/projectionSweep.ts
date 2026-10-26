import { Cause, Effect } from 'effect';
import type { StandingSweep } from '../../platform/contract/service/maintenance.js';
import type { ThreadRollouts } from '../contract/service/rollouts.js';

export const formingSweep =
  (rollouts: ThreadRollouts['Service']): StandingSweep =>
  (moment) =>
    rollouts.formLagging().pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning(`lagging thread journals could not be brought to the current form (${moment})`, {
          reason: Cause.squash(cause),
        }),
      ),
    );

export const projectionSweep =
  (rollouts: ThreadRollouts['Service']): StandingSweep =>
  (moment) =>
    rollouts.sweep().pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning(`the thread projection sweep could not run (${moment})`, { reason: Cause.squash(cause) }),
      ),
    );
