import { Clock, Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { writes } from '../platform/contract/service/writes.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { HomeFollowers } from '../thread-record/contract/service/homes.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { ThreadHomes } from './contract/service/homes.js';
import { ThreadRollouts } from './contract/service/rollouts.js';

export const makeThreadHomes = Effect.gen(function* () {
  const store = yield* MachineStore;
  const records = yield* ThreadRecords;
  const rollouts = yield* ThreadRollouts;
  const { all } = yield* HomeFollowers;
  const admit: ThreadHomes['Service']['admit'] = Effect.fn('ThreadHomes.admit')(function* (unit, move) {
    for (const follower of all) {
      if (follower.admit !== undefined) yield* Effect.provideService(follower.admit(unit, move), MachineStore, store);
    }
  });
  return ThreadHomes.of({
    writes: writes(
      'ThreadHomes.move',
      all.flatMap((follower) => follower.tables),
      records.writes,
    ),
    admit,
    move: Effect.fn('ThreadHomes.move')(function* (unit, move) {
      yield* admit(unit, move);
      const moved = yield* records.rehome(unit, move, new Date(yield* Clock.currentTimeMillis));
      if (!moved) {
        return yield* new GateRefusal('stale-revision', `Thread ${move.threadId} no longer stands in project ${move.from}.`, [
          "Read the thread's place again and decide the move against where it stands.",
        ]);
      }
      for (const follower of all) yield* Effect.provideService(follower.follow(unit, move), MachineStore, store);
      yield* unit.afterCommit(Effect.sync(() => rollouts.queueMeta(move.threadId)));
    }),
  });
});
