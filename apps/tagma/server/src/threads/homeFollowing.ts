import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import type { HomeFollowing } from '../thread-record/contract/service/homes.js';
import { threadJournalPlace } from './store/journal.js';
import { threadPlace } from './store/places.js';

export const threadHomes: HomeFollowing = {
  tables: [threadPlace, threadJournalPlace],
  follow: Effect.fn('Threads.followHome')(function* (unit, move) {
    const { db } = yield* MachineStore;
    yield* unit.run(db.delete(threadPlace).where(and(eq(threadPlace.threadId, move.threadId), eq(threadPlace.projectId, move.to))));
    yield* unit.run(db.insert(threadJournalPlace).values({ threadId: move.threadId, projectId: move.from }).onConflictDoNothing());
    yield* unit.run(
      db.delete(threadJournalPlace).where(and(eq(threadJournalPlace.threadId, move.threadId), eq(threadJournalPlace.projectId, move.to))),
    );
  }),
};
