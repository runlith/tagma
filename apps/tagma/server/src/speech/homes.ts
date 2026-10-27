import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import type { HomeFollowing } from '../thread-record/contract/service/homes.js';
import { listeningFollower } from './store/tables.js';

export const speechHomes: HomeFollowing = {
  tables: [listeningFollower],
  follow: Effect.fn('Speech.followHome')(function* (unit, move) {
    const { db } = yield* MachineStore;
    yield* unit.run(
      db
        .update(listeningFollower)
        .set({ projectId: move.to })
        .where(and(eq(listeningFollower.threadId, move.threadId), eq(listeningFollower.projectId, move.from))),
    );
  }),
};
