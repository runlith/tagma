import { Effect } from 'effect';
import type { ThreadRuns } from '../contract/service/runs.js';

export const endsWithRun = Effect.fnUntraced(function* (runs: ThreadRuns['Service'], thread: string, stop: Effect.Effect<void>) {
  const ended = yield* runs.ending(thread);
  //! stop runs outside the watching scope, since stopping usually closes that scope
  yield* Effect.forkScoped(Effect.andThen(ended, Effect.asVoid(Effect.forkDetach(stop))));
});
