import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { writes } from '../platform/contract/service/writes.js';
import { nativeRows, thread } from '../threads/store/kernel.js';
import { frozen, type RolloutParts } from '../threads/journal/rolloutMeta.js';
import { makeNativeFolds } from './rolloutFolds.js';

export const makeNativeRolloutPart = Effect.gen(function* () {
  return {
    folds: yield* makeNativeFolds,
    read: Effect.fnUntraced(function* (threadId) {
      const { db } = yield* MachineStore;
      const row = yield* db.select().from(thread).where(eq(thread.id, threadId)).get();
      return row === undefined ? null : frozen(row);
    }),
    write: Effect.fnUntraced(function* (row) {
      const { db } = yield* MachineStore;
      yield* db.insert(thread).values(row as typeof thread.$inferInsert);
    }),
    writes: writes('rollout.native', [nativeRows]),
  } satisfies RolloutParts['native'];
});
