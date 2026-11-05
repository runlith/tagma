import { toldDegraded } from '@runlith/activity/Activity';
import { ActivityLog } from '@runlith/activity/log';
import { ThreadEntryKinds, type ThreadReadWitness } from '@runlith/agent/transcript/kinds';
import { Clock, Effect } from 'effect';

//! A read repeats on every frame, so each kind of failure is told once; forgetting past this bound only tells one again.
const REMEMBERED_REPEATS = 4096;

export const witnessedReads = Effect.gen(function* () {
  const kinds = yield* ThreadEntryKinds;
  const witness = { log: yield* ActivityLog, clock: yield* Clock.Clock, thread: null, run: null };
  const told = new Set<string>();
  const tell: ThreadReadWitness = ({ place, why, repeat, failure }) => {
    if (told.has(repeat)) return;
    if (told.size >= REMEMBERED_REPEATS) told.clear();
    told.add(repeat);
    toldDegraded(witness, place, why, failure);
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => kinds.witnessing(tell)),
    (leave) => Effect.sync(leave),
  );
});
