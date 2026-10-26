import { and, eq, isNull } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { Unit } from '../platform/contract/service/units.js';
import { NATIVE_HARNESS } from '../platform/contract/wire/session.js';
import { threadRecord } from './store/table.js';
import type { RecordHarness, RecordScope } from './contract/service/records.js';

export const harnessed = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, served: RecordHarness) =>
  Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set({ harness: served.harness, agentId: served.agentId })
        .where(eq(threadRecord.id, id))
        .returning({ id: threadRecord.id }),
    ),
    (rows) => rows.length > 0,
  );

export const scope = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, facts: RecordScope) {
  if (facts.projectId === null) return false;
  const now = new Date(yield* Clock.currentTimeMillis);
  return yield* Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set({
          projectId: facts.projectId,
          origin: 'scoped',
          scopeBlockUuid: facts.scopeBlockUuid ?? null,
          createdBySessionId: facts.createdBySessionId ?? null,
          archivedAt: facts.archivedAt ?? null,
          title: facts.title,
          titleOrigin: facts.titleOrigin,
          harness: facts.harness ?? NATIVE_HARNESS,
          movedAt: facts.harness === undefined || facts.harness === NATIVE_HARNESS ? null : now,
          readerOrderAt: now,
        })
        .where(
          and(
            eq(threadRecord.id, id),
            isNull(threadRecord.projectId),
            eq(threadRecord.titleRevision, 0),
            eq(threadRecord.harness, NATIVE_HARNESS),
          ),
        )
        .returning({ id: threadRecord.id }),
    ),
    (rows) => rows.length > 0,
  );
});
