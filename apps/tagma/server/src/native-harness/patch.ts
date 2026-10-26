import type { ThreadPatch } from '@runlith/agent/thread/storage/aggregate';
import { eq } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { StoredFailure } from '../platform/store/crossing.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import { thread } from '../threads/store/kernel.js';
import type { ThreadRecords } from '../thread-record/contract/service/records.js';
import { writeMandate } from '../threads/mandate.js';
import { NATIVE_HARNESS } from '../platform/contract/wire/session.js';
import type { ModelChanges } from '../threads/contract/service/modelChanges.js';

export const applyPatch = (
  db: StoreDb<'machine'>,
  records: ThreadRecords['Service'],
  models: ModelChanges['Service'],
  unit: WriteUnit<'machine'>,
  id: string,
  patch: ThreadPatch,
): Effect.Effect<void, StoredFailure> => {
  const { status, authority, budgetTokens, hostKind, hostId, parentThreadId, spawnedByRunId, createdBy, agentId, ...native } = patch;
  const fixed = Object.entries({ parentThreadId, spawnedByRunId, createdBy })
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  if (fixed.length > 0) return Effect.die(new Error(`Thread ${id}: a patch cannot move its record's ${fixed.join(', ')}.`));
  const mandate = Object.fromEntries(
    Object.entries({ authority, budgetTokens, hostKind, hostId }).filter(([, value]) => value !== undefined),
  );
  return Effect.gen(function* () {
    if (status !== undefined) yield* records.publishStatus(unit, id, { status });
    if (agentId !== undefined) yield* records.harnessed(unit, id, { harness: NATIVE_HARNESS, agentId });
    if (Object.keys(mandate).length > 0) yield* writeMandate(db, unit, id, mandate);
    const updatedAt = new Date(yield* Clock.currentTimeMillis);
    const moved = yield* models.record(
      unit,
      id,
      native,
      unit.run(
        db
          .update(thread)
          .set({ ...native, updatedAt })
          .where(eq(thread.id, id))
          .returning({ id: thread.id }),
      ),
    );
    if (moved.length > 0) return;
    const carried = Object.entries(native).flatMap(([key, value]) => (value === undefined || !(key in thread) ? [] : [key]));
    if (carried.length === 0)
      return yield* Effect.asVoid(records.publishStatus(unit, id, { movedAt: new Date(yield* Clock.currentTimeMillis) }));
    if ((yield* records.facts(id, unit)) !== undefined) {
      return yield* Effect.die(new Error(`Thread ${id}: ${carried.join(', ')} belong to a native row, and this record has none.`));
    }
  });
};
