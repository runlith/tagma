import { Clock, Effect } from 'effect';
import type { NativeThreadRows, StalledRun } from '../rows/native.js';

const keyOf = (run: StalledRun) => `${run.runId}@${run.movedAt.getTime()}`;

export const stallSighting = (threads: NativeThreadRows) => {
  let named = new Set<string>();
  return {
    pass: Effect.fnUntraced(function* () {
      const standing = yield* threads.stalledRuns(new Date(yield* Clock.currentTimeMillis));
      const sighted = standing.filter((run) => !named.has(keyOf(run)));
      named = new Set(standing.map(keyOf));
      return sighted;
    }),
  };
};
