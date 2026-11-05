import { toldDegraded } from '@runlith/activity/Activity';
import { ActivityLog } from '@runlith/activity/log';
import { ActivityFaults } from '@runlith/activity/store/faults';
import type { ThreadReadWitness } from '@runlith/agent/contracts';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { Clock, Effect } from 'effect';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';

//! A read repeats on every frame, so each failure of a thread is told once while its note stands in the error list; past this bound the oldest is forgotten and told again on its next read.
const REMEMBERED_REPEATS = 4096;

export const witnessedReads = Effect.gen(function* () {
  const kinds = yield* ThreadEntryKinds;
  const records = yield* ThreadRecords;
  const faults = yield* ActivityFaults;
  const log = yield* ActivityLog;
  const clock = yield* Clock.Clock;
  const told = new Map<string, number>();
  const tell: ThreadReadWitness = ({ thread, place, why, repeat, failure }) => {
    const key = `${thread}\n${repeat}`;
    const at = told.get(key);
    if (at !== undefined && at > faults.since(clock.currentTimeMillisUnsafe())) return;
    told.delete(key);
    const oldest = told.size >= REMEMBERED_REPEATS ? told.keys().next() : null;
    if (oldest !== null && oldest.done !== true) told.delete(oldest.value);
    told.set(key, toldDegraded({ log, clock, thread, run: null }, place, why, failure));
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => kinds.witnessing(tell)),
    (leave) => Effect.sync(leave),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => records.readDegraded(tell)),
    (leave) => Effect.sync(leave),
  );
});
