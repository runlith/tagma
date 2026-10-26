import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { Place } from '../../platform/contract/wire/place.js';
import { callPlace } from '../store/places.js';
import { writes } from '../../platform/contract/service/writes.js';

export type PlaceKey = { readonly threadId: string; readonly operation: string; readonly key: string };

const where = (key: PlaceKey) =>
  and(eq(callPlace.threadId, key.threadId), eq(callPlace.operation, key.operation), eq(callPlace.key, key.key));

export const recordedPlace = Effect.fn('invocation.recordedPlace')(function* (store: MachineStore['Service'], key: PlaceKey) {
  const rows = yield* store.db
    .select({ projectId: callPlace.projectId, checkout: callPlace.checkout, branch: callPlace.branch })
    .from(callPlace)
    .where(where(key))
    .limit(1);
  return rows[0] ?? null;
});

export const recordPlace = Effect.fn('invocation.recordPlace')(function* (store: MachineStore['Service'], key: PlaceKey, place: Place) {
  return yield* store.transaction(writes('Invocation.place', [callPlace]), (unit) =>
    Effect.gen(function* () {
      yield* unit.run(
        store.db
          .insert(callPlace)
          .values({ ...key, ...place })
          .onConflictDoNothing(),
      );
      const rows = yield* unit.run(
        store.db
          .select({ projectId: callPlace.projectId, checkout: callPlace.checkout, branch: callPlace.branch })
          .from(callPlace)
          .where(where(key))
          .limit(1),
      );
      return rows[0]!;
    }),
  );
});
