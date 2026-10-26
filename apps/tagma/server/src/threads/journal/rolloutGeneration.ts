import { sql } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import type { MachineStore, StoreDb } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadRolloutCursor, threadRolloutForm } from '../store/journal.js';
import { RolloutUnreadable } from './rolloutFile.js';

const turning = writes('ThreadRollout.generation', [threadRolloutCursor]);
const unreadable = (path: string) => (cause: { readonly message: string }) =>
  new RolloutUnreadable({ reason: 'io', path, message: cause.message });

export const rolloutTransformed = (
  store: MachineStore['Service'],
  threadId: string,
  path: string,
): Effect.Effect<void, RolloutUnreadable> =>
  store
    .transaction(turning, (unit) =>
      unit.run(
        store.db
          .insert(threadRolloutCursor)
          .values({ threadId, generation: 1 })
          .onConflictDoUpdate({
            target: threadRolloutCursor.threadId,
            set: { generation: sql`${threadRolloutCursor.generation} + 1` },
          }),
      ),
    )
    .pipe(Effect.asVoid, Effect.mapError(unreadable(path)));

export const rolloutReplacedIn = (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  threadId: string,
  path: string,
): Effect.Effect<void, RolloutUnreadable> =>
  unit
    .run(
      db
        .insert(threadRolloutCursor)
        .values({ threadId, generation: 1 })
        .onConflictDoUpdate({
          target: threadRolloutCursor.threadId,
          set: { generation: sql`${threadRolloutCursor.generation} + 1`, nextByteOffset: 0, nextPosition: 1 },
        }),
    )
    .pipe(Effect.asVoid, Effect.mapError(unreadable(path)));

const exported = writes('ThreadRollout.exported', [threadRolloutCursor, threadRolloutForm]);

export const rolloutReplaced = Effect.fn('ThreadRollout.replaced')(function* (
  store: MachineStore['Service'],
  threadId: string,
  path: string,
) {
  yield* store
    .transaction(exported, (unit) =>
      Effect.gen(function* () {
        const formedAt = new Date(yield* Clock.currentTimeMillis);
        yield* rolloutReplacedIn(store.db, unit, threadId, path);
        yield* unit
          .run(
            store.db
              .insert(threadRolloutForm)
              .values({ threadId, formedAt })
              .onConflictDoUpdate({
                target: threadRolloutForm.threadId,
                set: { formedAt, refusal: null, publishing: null },
              }),
          )
          .pipe(Effect.mapError(unreadable(path)));
      }),
    )
    .pipe(Effect.mapError((cause) => (cause._tag === 'RolloutUnreadable' ? cause : unreadable(path)(cause))));
});
