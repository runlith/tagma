import { Effect } from 'effect';
import type { SessionName } from '../../thread-record/names.js';
import { workspaceChange } from '../store/tables.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { StoreShape } from './places.js';
import type { TeamMember } from '../contract/service/prepared.js';
import type { WorkOrigin } from '../../workspace/contract/wire/place.js';
import { and, eq, exists, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { recordFacts } from '../../thread-record/facts.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { subtreeOf } from '../../thread-record/lineage.js';
import { chunk, unique } from '@runlith/utils/collection';
import { rowsPerStatement } from '../../platform/store/binds.js';

export const namesOfHolders = Effect.fn('ChangeRecord.namesOfHolders')(function* (store: StoreShape, holders: readonly string[]) {
  const names = new Map<string, SessionName>();
  for (const ids of chunk(unique(holders), rowsPerStatement(1))) {
    const rows = yield* store.db
      .select({ id: recordFacts.id, title: recordFacts.title, name: recordFacts.name, archivedAt: recordFacts.archivedAt })
      .from(recordFacts)
      .where(
        and(
          inArray(recordFacts.id, ids),
          exists(
            store.db
              .select({ id: workspaceChange.id })
              .from(workspaceChange)
              .where(and(eq(workspaceChange.holder, recordFacts.id), eq(workspaceChange.holderProjectId, recordFacts.projectId))),
          ),
        ),
      );
    for (const row of rows) names.set(row.id, { title: row.title, name: row.name, ended: row.archivedAt !== null });
  }
  return names;
});

export const homesOfHolders = Effect.fn('ChangeRecord.homesOfHolders')(function* (store: StoreShape, holders: readonly string[]) {
  const homes = new Map<string, number>();
  for (const ids of chunk(unique(holders), rowsPerStatement(1))) {
    const rows = yield* store.db
      .selectDistinct({ id: workspaceChange.holder, projectId: workspaceChange.holderProjectId })
      .from(workspaceChange)
      .where(and(inArray(workspaceChange.holder, ids), isNotNull(workspaceChange.holderProjectId)));
    for (const row of rows) if (row.projectId !== null) homes.set(row.id, row.projectId);
  }
  return homes as ReadonlyMap<string, number>;
});

export const runningRunOf = Effect.fn('WorkspaceChangeLog.runningRunOf')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  projectId: number,
  threadId: string,
): Effect.Effect<string | null, StoreFailure> {
  return units.read((unit) =>
    unit.run(
      store.db
        .select({ id: threadRecord.runningRunId })
        .from(threadRecord)
        .where(and(eq(threadRecord.id, threadId), eq(threadRecord.projectId, projectId)))
        .pipe(Effect.map((rows) => rows[0]?.id ?? null)),
    ),
  );
});

export const runningRunsOf = Effect.fn('WorkspaceChangeLog.runningRunsOf')(function (
  store: StoreShape,
  projectId: number,
  threadIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, string>, StoreFailure> {
  if (threadIds.length === 0) return Effect.succeed(new Map<string, string>());
  return store.db
    .select({ threadId: threadRecord.id, id: threadRecord.runningRunId })
    .from(threadRecord)
    .where(
      and(eq(threadRecord.projectId, projectId), inArray(threadRecord.id, [...new Set(threadIds)]), isNotNull(threadRecord.runningRunId)),
    )
    .pipe(Effect.map((rows) => new Map(rows.flatMap((row) => (row.id === null ? [] : [[row.threadId, row.id] as const])))));
});

export const retired = (archivedAt: Date | null): boolean => archivedAt !== null;

export const runningOf = Effect.fn('WorkspaceChangeLog.runningOf')(function (
  store: StoreShape,
  projectId: number,
  threadIds: readonly string[],
): Effect.Effect<readonly string[], StoreFailure> {
  if (threadIds.length === 0) return Effect.succeed([]);
  return store.db
    .select({ id: recordFacts.id })
    .from(recordFacts)
    .where(and(eq(recordFacts.projectId, projectId), inArray(recordFacts.id, [...new Set(threadIds)]), eq(recordFacts.status, 'running')))
    .pipe(Effect.map((rows) => rows.map((row) => row.id)));
});

export const teamOf = Effect.fn('WorkspaceChangeLog.teamOf')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  work: WorkOrigin,
): Effect.Effect<readonly TeamMember[], StoreFailure> {
  return units.read((unit) =>
    unit.run(
      store.db
        .select({ id: threadRecord.id, projectId: threadRecord.projectId, status: threadRecord.status })
        .from(threadRecord)
        .where(
          and(
            sql`${threadRecord.id} in ${subtreeOf(work.threadId)}`,
            ne(threadRecord.id, work.threadId),
            ne(threadRecord.status, 'running'),
          ),
        )
        .pipe(Effect.map((rows) => [work, ...rows.map((row) => ({ projectId: row.projectId, threadId: row.id }))])),
    ),
  );
});
