import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { threadRolloutCursor } from '../store/journal.js';
import { restStamps } from '../rest.js';

export const restFor = (db: StoreDb<'machine'>, id: string, at: Date | null): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(
    db
      .insert(threadRolloutCursor)
      .values({ threadId: id, restedAt: at })
      .onConflictDoUpdate({ target: threadRolloutCursor.threadId, set: { restedAt: at } }),
  );

export const restOf = (db: StoreDb<'machine'>, id: string): Effect.Effect<Date | null, StoreFailure> =>
  Effect.map(db.select({ at: restStamps.restedAt }).from(restStamps).where(eq(restStamps.id, id)).get(), (row) => row?.at ?? null);
