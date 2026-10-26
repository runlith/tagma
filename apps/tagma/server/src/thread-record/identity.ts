import { parseThreadBornOf } from '@runlith/agent/thread/persisted';
import { and, count, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { Unit } from '../platform/contract/service/units.js';
import { NATIVE_HARNESS, type HarnessId } from '../platform/contract/wire/session.js';
import { trusted } from '../platform/store/crossing.js';
import { recordFacts } from './facts.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';
import type { ThreadRecordFacts } from './contract/wire/record.js';
import type { AddressFrom } from './contract/service/records.js';

export const factsWhere = (db: StoreDb<'machine'>, where: SQL) => db.select().from(recordFacts).where(where);

type FactRow = Effect.Success<ReturnType<typeof factsWhere>>[number];

export const factsOf = (row: FactRow): ThreadRecordFacts => ({
  id: row.id as ThreadId,
  projectId: row.projectId,
  origin: row.projectId === null ? 'unscoped' : 'scoped',
  parentId: row.parentId as ThreadId | null,
  spawnRootId: row.spawnRootId as ThreadId,
  detachedFrom: row.detachedFrom as ThreadId | null,
  detachedAt: row.detachedAt,
  principalId: row.principalId,
  name: row.name,
  title: row.title,
  titleProvenance: row.titleOrigin,
  titleRevision: row.titleRevision,
  harness: (row.harness ?? NATIVE_HARNESS) as HarnessId,
  agentId: row.agentId,
  bornOf: parseThreadBornOf(row.bornOf),
  spawnedByRunId: row.spawnedByRunId,
  createdBy: row.createdBy,
  scopeBlockUuid: row.scopeBlockUuid,
  createdBySessionId: row.createdBySessionId,
  readerOrderAt: row.readerOrderAt,
  pinnedAt: row.pinnedAt,
  archivedAt: row.archivedAt,
  status: row.status,
  runningRunId: row.runningRunId,
  recap: row.recap,
  createdAt: row.createdAt,
});

export const facts = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string) =>
  Effect.flatMap(unit.run(factsWhere(db, eq(recordFacts.id, id)).get()), (row) =>
    row === undefined ? Effect.succeed(undefined) : trusted('ThreadRecords.facts', () => factsOf(row)),
  );

export const projectOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string) =>
  Effect.map(
    unit.run(db.select({ projectId: recordFacts.projectId }).from(recordFacts).where(eq(recordFacts.id, id)).get()),
    (row) => row?.projectId ?? undefined,
  );

export const projectsOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, ids: readonly string[]) =>
  Effect.map(
    unit.run(
      db
        .select({ id: recordFacts.id, projectId: recordFacts.projectId })
        .from(recordFacts)
        .where(inArray(recordFacts.id, [...ids]))
        .all(),
    ),
    (rows) => new Map(rows.map((row) => [row.id, row.projectId])),
  );

export const countIn = (db: StoreDb<'machine'>, unit: Unit<'machine'>, projectId: number) =>
  Effect.map(
    unit.run(db.select({ held: count() }).from(recordFacts).where(eq(recordFacts.projectId, projectId)).get()),
    (row) => row?.held ?? 0,
  );

export const addressOf = Effect.fn('ThreadRecords.address')(function* (db: StoreDb<'machine'>, address: string, from: AddressFrom) {
  const exact = yield* db
    .select({ threadId: recordFacts.id, projectId: recordFacts.projectId })
    .from(recordFacts)
    .where(eq(recordFacts.id, address))
    .limit(1);
  const found = exact[0];
  if (found !== undefined && found.projectId !== null) return { threadId: found.threadId as ThreadId, projectId: found.projectId };
  if (from.projectId === null) return null;
  const caller =
    from.threadId === null
      ? null
      : ((yield* db
          .select({ ownerId: recordFacts.principalId, spawnRootId: recordFacts.spawnRootId })
          .from(recordFacts)
          .where(and(eq(recordFacts.id, from.threadId), eq(recordFacts.projectId, from.projectId)))
          .limit(1))[0] ?? null);
  const named = yield* db
    .select({ threadId: recordFacts.id, projectId: recordFacts.projectId })
    .from(recordFacts)
    .where(
      and(
        isNotNull(recordFacts.projectId),
        eq(recordFacts.name, address),
        ...(caller === null
          ? [eq(recordFacts.projectId, from.projectId)]
          : [eq(recordFacts.principalId, caller.ownerId), eq(recordFacts.spawnRootId, caller.spawnRootId)]),
      ),
    )
    .limit(2);
  const member = named.length === 1 ? named[0] : undefined;
  return member !== undefined && member.projectId !== null ? { threadId: member.threadId as ThreadId, projectId: member.projectId } : null;
});

export const namesIn = (db: StoreDb<'machine'>, unit: Unit<'machine'>, projectId: number) =>
  Effect.map(
    unit.run(db.select({ title: recordFacts.title }).from(recordFacts).where(eq(recordFacts.projectId, projectId)).all()),
    (rows) => new Set(rows.flatMap((row) => (row.title === null ? [] : [row.title]))),
  );
