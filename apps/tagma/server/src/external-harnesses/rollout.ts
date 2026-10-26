import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { writes } from '../platform/contract/service/writes.js';
import { frozen, type RolloutPart } from '../threads/journal/rolloutMeta.js';
import { activeOf, externalSession, sessionValues } from '../threads/store/harnessFacet.js';

const stored = {
  id: externalSession.id,
  facet: externalSession.facet,
  updatedAt: externalSession.updatedAt,
};

export const externalRolloutPart: RolloutPart = {
  read: Effect.fnUntraced(function* (threadId: string) {
    const { db } = yield* MachineStore;
    const row = yield* db.select(stored).from(externalSession).where(eq(externalSession.id, threadId)).get();
    return row === undefined ? null : frozen(row);
  }),
  write: Effect.fnUntraced(function* (row: Parameters<RolloutPart['write']>[0]) {
    const { db } = yield* MachineStore;
    const facet = row.facet as typeof externalSession.$inferInsert.facet;
    yield* db
      .insert(externalSession)
      .values({ ...row, ...sessionValues(facet), activeAt: activeOf(facet) } as typeof externalSession.$inferInsert);
  }),
  writes: writes('rollout.external', [externalSession]),
};
