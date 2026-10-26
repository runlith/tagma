import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { Context, Effect } from 'effect';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { recordFacts } from '../../thread-record/facts.js';
import { sessionOf, sessionRows } from './harnessFacet.js';
import { parseExternalSession, type ExternalSession } from '../contract/wire/harness/externalSession.js';

export class SessionLookupStore extends Context.Service<
  SessionLookupStore,
  {
    harnessOf(threadId: string): Effect.Effect<ExternalSession | null | undefined, StoreFailure>;
    adoptedOn(execution: string, witness: ProcessWitness): Effect.Effect<string | null, StoreFailure>;
    adoptedIn(projectId: number, executions: readonly string[]): Effect.Effect<ReadonlyMap<string, string>, StoreFailure>;
    keyed(projectId: number, harness: string, key: string, unit: Unit<'machine'>): Effect.Effect<string | null, StoreFailure>;
  }
>()('tagma/threads/SessionLookupStore') {}

export const makeSessionLookups = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return SessionLookupStore.of({
    harnessOf: (threadId) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ harness: sessionOf(recordFacts.id) })
              .from(recordFacts)
              .where(and(eq(recordFacts.id, threadId), isNotNull(recordFacts.projectId)))
              .get(),
          ),
          (row) => (row === undefined ? undefined : parseExternalSession(row.harness)),
        ),
      ),
    adoptedOn: (execution, witness) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ threadId: sessionRows.id })
              .from(sessionRows)
              .where(sql`json_extract(${sessionRows.facet}, '$.session.origin') = 'adopted'
              and json_extract(${sessionRows.facet}, '$.session.state') in ('starting', 'running', 'stopping', 'uncertain')
              and json_extract(${sessionRows.facet}, '$.execution.execution') = ${execution}
              and json_extract(${sessionRows.facet}, '$.session.job.pid') = ${witness.pid}
               and json_extract(${sessionRows.facet}, '$.session.job.birth') = ${witness.birth}`)
              .get(),
          ),
          (row) => row?.threadId ?? null,
        ),
      ),
    adoptedIn: (projectId, executions) =>
      executions.length === 0
        ? Effect.succeed(new Map())
        : units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select({
                    threadId: sessionRows.id,
                    execution: sql<string>`json_extract(${sessionRows.facet}, '$.execution.execution')`,
                  })
                  .from(sessionRows)
                  .innerJoin(recordFacts, eq(recordFacts.id, sessionRows.id))
                  .where(
                    and(
                      eq(recordFacts.projectId, projectId),
                      sql`json_extract(${sessionRows.facet}, '$.session.origin') = 'adopted'`,
                      sql`json_extract(${sessionRows.facet}, '$.session.state') in ('starting', 'running', 'stopping', 'uncertain')`,
                      inArray(sql`json_extract(${sessionRows.facet}, '$.execution.execution')`, [...executions]),
                    ),
                  )
                  .all(),
              ),
              (rows) => new Map(rows.map((row) => [row.execution, row.threadId])),
            ),
          ),
    keyed: (projectId, harness, key, unit) =>
      Effect.map(
        unit.run(
          db
            .select({ threadId: sessionRows.id })
            .from(sessionRows)
            .innerJoin(recordFacts, eq(recordFacts.id, sessionRows.id))
            .where(
              and(
                eq(recordFacts.projectId, projectId),
                isNull(recordFacts.archivedAt),
                sql`json_extract(${sessionRows.facet}, '$.name') = ${harness}`,
                sql`json_extract(${sessionRows.facet}, '$.sessionKey') = ${key}`,
              ),
            )
            .orderBy(asc(sessionRows.id))
            .get(),
        ),
        (row) => row?.threadId ?? null,
      ),
  });
});
