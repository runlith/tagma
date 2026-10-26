import { inArray } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { among } from '../platform/store/rows.js';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';
import { threadRecord } from './store/table.js';
import type { RecordAddress, RecordBirth } from './contract/service/records.js';

export const insertRecord = Effect.fnUntraced(function* (db: StoreDb<'machine'>, birth: RecordBirth) {
  const createdAt = birth.createdAt ?? new Date(yield* Clock.currentTimeMillis);
  const projectId = birth.projectId ?? null;
  return yield* Effect.asVoid(
    db.insert(threadRecord).values({
      id: birth.id,
      projectId,
      origin: projectId === null ? 'unscoped' : 'scoped',
      parentId: birth.parentId ?? null,
      spawnRootId: birth.spawnRootId,
      detachedFrom: birth.detachedFrom ?? null,
      detachedAt: birth.detachedAt ?? null,
      principalId: birth.principalId,
      name: birth.name ?? null,
      title: birth.title,
      titleOrigin: birth.titleOrigin,
      titleRevision: birth.titleRevision,
      titleAskedInput: birth.titleAskedInput ?? null,
      harness: birth.harness,
      agentId: birth.agentId,
      bornOf: birth.bornOf ?? null,
      spawnedByRunId: birth.spawnedByRunId ?? null,
      createdBy: birth.createdBy ?? null,
      scopeBlockUuid: birth.scopeBlockUuid ?? null,
      createdBySessionId: birth.createdBySessionId ?? null,
      readerOrderAt: birth.readerOrderAt ?? createdAt,
      pinnedAt: birth.pinnedAt ?? null,
      archivedAt: birth.archivedAt ?? null,
      status: birth.status,
      runningRunId: null,
      movedAt: birth.movedAt ?? null,
      recap: birth.recap ?? null,
      createdAt,
    }),
  );
});

export const removeRecords = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, ids: readonly string[]) =>
  Effect.map(
    unit.run(
      db
        .delete(threadRecord)
        .where(inArray(threadRecord.id, among(ids)))
        .returning({ threadId: threadRecord.id, projectId: threadRecord.projectId }),
    ),
    (rows) =>
      rows.flatMap(({ threadId, projectId }): RecordAddress[] =>
        projectId === null ? [] : [{ threadId: threadId as ThreadId, projectId }],
      ),
  );
