import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { Clock, type Context, Effect } from 'effect';
import type { ExecutionId, Incarnation } from '@runlith/executions/protocol/execution';
import {
  commandRevision as commandRevisionTable,
  custody as custodyTable,
  execution as executionTable,
  executionDependency as dependencyTable,
  executionDeparture as departureTable,
  executionPace as paceTable,
  executionRules as rulesTable,
  finalFacts as finalFactsTable,
  generationLedger as generationLedgerTable,
  incarnation as incarnationTable,
  operation as operationTable,
  recordRemoval as recordRemovalTable,
  stopIntent as stopIntentTable,
} from '../db/schema';
import type { ExecutionStore, OpenedStore } from './ExecutionStore';
import { StoredExecutionMissing } from './errors';
import {
  decodeExecutionId,
  finalFrom,
  unreadable,
  type GenerationPage,
  type RetainedExecution,
  type RetiredGeneration,
  type RecordRemoval,
  type RetiredLedgerEntry,
  type ShelfLedger,
} from './records';

type Shape = Context.Service.Shape<typeof ExecutionStore>;

type EvictionScan = { readonly execution: string; readonly position: number; readonly scanned: boolean };

const EVICT_HOLD_MS = 20;

export const generations = (
  store: OpenedStore,
): Pick<
  Shape,
  | 'evidenceOf'
  | 'oldestGeneration'
  | 'generationExecutions'
  | 'shelfLedger'
  | 'shelvedRecords'
  | 'beginRemoval'
  | 'endRemoval'
  | 'unfinishedRemovals'
  | 'retiredGenerations'
  | 'retiredLedger'
  | 'noteRecordPending'
  | 'sealRecordBytes'
  | 'setGenerationBytes'
  | 'beginEviction'
  | 'evictGeneration'
> => {
  const { db, capacity, held, unit, recordOf } = store;

  const evictSlice = (incarnation: Incarnation, rows: number, keyed: EvictionScan) =>
    unit(
      Effect.gen(function* () {
        const marked = yield* db
          .select({ incarnation: incarnationTable.incarnation })
          .from(incarnationTable)
          .where(
            and(eq(incarnationTable.incarnation, incarnation), eq(incarnationTable.current, false), eq(incarnationTable.evicting, true)),
          )
          .limit(1);
        if (marked[0] === undefined) return { done: true, keyed } as const;
        let scan = keyed;
        let left = rows;
        let heldBytes = 0;
        let heldRows = 0;
        while (left > 0) {
          const next = yield* db
            .select({ executionId: executionTable.executionId })
            .from(executionTable)
            .where(eq(executionTable.incarnation, incarnation))
            .limit(1);
          const execution = next[0]?.executionId;
          if (execution === undefined) {
            yield* db.delete(recordRemovalTable).where(eq(recordRemovalTable.incarnation, incarnation));
            yield* db.delete(generationLedgerTable).where(eq(generationLedgerTable.incarnation, incarnation));
            yield* db
              .delete(incarnationTable)
              .where(and(eq(incarnationTable.incarnation, incarnation), eq(incarnationTable.current, false)));
            return { done: true, keyed: scan } as const;
          }
          heldBytes += execution.length * 2;
          heldRows += 1;
          if (scan.execution !== execution) scan = { execution, position: 0, scanned: false };
          if (!scan.scanned) {
            const asked = left;
            const keys = yield* db
              .select({ position: sql<number>`rowid` })
              .from(operationTable)
              .where(sql`execution_id = ${execution} AND rowid > ${scan.position}`)
              .orderBy(sql`rowid`)
              .limit(asked);
            const last = keys.at(-1)?.position;
            if (last !== undefined) {
              const calls = sql`SELECT victim_call.installation, victim_call.operation_id FROM operation AS victim_key
                INNER JOIN call AS victim_call ON victim_call.installation = victim_key.installation AND victim_call.operation_id = victim_key.operation_id
                WHERE victim_key.execution_id = ${execution} AND victim_key.rowid > ${scan.position} AND victim_key.rowid <= ${last}
                AND victim_call.execution_id = victim_key.execution_id`;
              yield* db.run(sql`INSERT OR IGNORE INTO spent_key (installation, operation_id, incarnation, kind)
                SELECT keyed.installation, keyed.operation_id, NULL, 'receipt' FROM (${calls}) AS keyed`);
              yield* db.run(sql`DELETE FROM call_decision WHERE (installation, operation_id) IN (${calls})`);
              yield* db.run(sql`DELETE FROM call WHERE (installation, operation_id) IN (${calls})`);
            }
            left -= keys.length;
            heldBytes += keys.length * 8;
            heldRows += keys.length;
            scan = { execution, position: last ?? scan.position, scanned: keys.length < asked };
            if (!scan.scanned) continue;
          }
          const revisionsAsked = left;
          const revisions = yield* db
            .select({ revision: commandRevisionTable.revision })
            .from(commandRevisionTable)
            .where(eq(commandRevisionTable.executionId, execution))
            .orderBy(asc(commandRevisionTable.revision))
            .limit(revisionsAsked);
          const lastRevision = revisions.at(-1)?.revision;
          if (lastRevision !== undefined) {
            const span = sql`execution_id = ${execution} AND revision <= ${lastRevision}`;
            yield* db.run(sql`INSERT OR IGNORE INTO spent_key (installation, operation_id, incarnation, kind)
              SELECT installation, operation_id, NULL, 'receipt' FROM command_revision WHERE ${span}`);
            yield* db.run(sql`DELETE FROM command_revision WHERE ${span}`);
          }
          left -= revisions.length;
          heldBytes += revisions.length * 8;
          heldRows += revisions.length;
          if (revisions.length === revisionsAsked) continue;
          const stopsAsked = left;
          const stops = yield* db
            .select({ installation: stopIntentTable.installation, operationId: stopIntentTable.operationId })
            .from(stopIntentTable)
            .where(eq(stopIntentTable.executionId, execution))
            .orderBy(asc(stopIntentTable.installation), asc(stopIntentTable.operationId))
            .limit(stopsAsked);
          const lastStop = stops.at(-1);
          if (lastStop !== undefined) {
            const span = sql`execution_id = ${execution} AND (installation, operation_id) <= (${lastStop.installation}, ${lastStop.operationId})`;
            yield* db.run(sql`INSERT OR IGNORE INTO spent_key (installation, operation_id, incarnation, kind)
              SELECT installation, operation_id, NULL, 'receipt' FROM stop_intent WHERE ${span}`);
            yield* db.run(sql`DELETE FROM stop_intent WHERE ${span}`);
          }
          left -= stops.length;
          for (const stop of stops) heldBytes += (stop.installation.length + stop.operationId.length) * 2;
          heldRows += stops.length;
          if (stops.length === stopsAsked) continue;
          const dependenciesAsked = left;
          const dependencies = yield* db
            .select({ position: dependencyTable.position })
            .from(dependencyTable)
            .where(eq(dependencyTable.executionId, execution))
            .orderBy(asc(dependencyTable.position))
            .limit(dependenciesAsked);
          const lastDependency = dependencies.at(-1)?.position;
          if (lastDependency !== undefined) {
            yield* db.run(sql`DELETE FROM execution_dependency WHERE execution_id = ${execution} AND position <= ${lastDependency}`);
          }
          left -= dependencies.length;
          heldBytes += dependencies.length * 8;
          heldRows += dependencies.length;
          if (dependencies.length === dependenciesAsked) continue;
          yield* db.delete(paceTable).where(eq(paceTable.executionId, execution));
          yield* db.delete(rulesTable).where(eq(rulesTable.executionId, execution));
          yield* db.delete(departureTable).where(eq(departureTable.executionId, execution));
          yield* db.delete(custodyTable).where(eq(custodyTable.executionId, execution));
          yield* db.delete(finalFactsTable).where(eq(finalFactsTable.executionId, execution));
          yield* db.delete(executionTable).where(eq(executionTable.executionId, execution));
          left -= 5;
        }
        return { done: false, keyed: scan, heldBytes, heldRows } as const;
      }),
    );

  return {
    evidenceOf: (ref) =>
      unit(
        Effect.gen(function* () {
          if (ref.installation !== held.installation) {
            return yield* new StoredExecutionMissing({ execution: ref.execution });
          }
          const rows = yield* db
            .select({ execution: executionTable })
            .from(executionTable)
            .innerJoin(
              incarnationTable,
              and(eq(incarnationTable.incarnation, executionTable.incarnation), eq(incarnationTable.evicting, false)),
            )
            .where(and(eq(executionTable.executionId, ref.execution), eq(executionTable.incarnation, ref.incarnation)))
            .limit(1);
          const row = rows[0]?.execution;
          if (row === undefined) return yield* new StoredExecutionMissing({ execution: ref.execution });
          const record = yield* recordOf(row);
          const facts = yield* db
            .select()
            .from(finalFactsTable)
            .where(and(eq(finalFactsTable.executionId, ref.execution), eq(finalFactsTable.incarnation, ref.incarnation)))
            .limit(1);
          const final = facts[0] === undefined ? undefined : yield* finalFrom(facts[0]);
          return { record, final: final } satisfies RetainedExecution;
        }),
      ),

    oldestGeneration: () =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select({ incarnation: incarnationTable.incarnation, evicting: incarnationTable.evicting })
            .from(incarnationTable)
            .where(eq(incarnationTable.current, false))
            .orderBy(asc(incarnationTable.incarnation))
            .limit(1);
          return rows[0];
        }),
      ),

    generationExecutions: (incarnation, after, limit) =>
      unit(
        Effect.gen(function* () {
          const position = sql<number>`rowid`;
          const owned = yield* db
            .select({ position, execution: executionTable.executionId })
            .from(executionTable)
            .where(and(eq(executionTable.incarnation, incarnation), after === undefined ? undefined : gt(position, after)))
            .orderBy(position)
            .limit(limit);
          const executions = yield* Effect.forEach(owned, (row) =>
            decodeExecutionId(row.execution).pipe(Effect.mapError(unreadable('execution', row.execution))),
          );
          const last = owned.at(-1);
          return { executions, next: owned.length === limit && last !== undefined ? last.position : undefined } satisfies GenerationPage;
        }),
      ),

    shelfLedger: (incarnation) =>
      unit(
        Effect.gen(function* () {
          const ledger = yield* db
            .select({ bytes: generationLedgerTable.bytes })
            .from(generationLedgerTable)
            .where(eq(generationLedgerTable.incarnation, incarnation))
            .limit(1);
          const newest = yield* db.select({ position: sql<number | null>`max(rowid)` }).from(executionTable);
          return { bytes: ledger[0]?.bytes ?? 0, through: newest[0]?.position ?? undefined } satisfies ShelfLedger;
        }),
      ),

    beginRemoval: (ref, ledgered) =>
      unit(
        db
          .insert(recordRemovalTable)
          .values({ executionId: ref.execution, incarnation: ref.incarnation, ledgered: ledgered ?? null })
          .onConflictDoUpdate({ target: recordRemovalTable.executionId, set: { ledgered: ledgered ?? null } }),
      ).pipe(Effect.asVoid),

    endRemoval: (execution) =>
      unit(
        Effect.gen(function* () {
          const ended = yield* db
            .delete(recordRemovalTable)
            .where(eq(recordRemovalTable.executionId, execution))
            .returning({ incarnation: recordRemovalTable.incarnation, ledgered: recordRemovalTable.ledgered });
          const removal = ended[0];
          if (removal === undefined || removal.ledgered === null) return;
          yield* db
            .update(generationLedgerTable)
            .set({
              bytes: sql`max(0, ${generationLedgerTable.bytes} - ${removal.ledgered})`,
              pending: sql`max(0, ${generationLedgerTable.pending} - 1)`,
            })
            .where(eq(generationLedgerTable.incarnation, removal.incarnation));
        }),
      ),

    unfinishedRemovals: (incarnation) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db.select().from(recordRemovalTable).where(eq(recordRemovalTable.incarnation, incarnation));
          return yield* Effect.forEach(rows, (row) =>
            Effect.map(
              decodeExecutionId(row.executionId).pipe(Effect.mapError(unreadable('record-removal', row.executionId))),
              (execution): RecordRemoval => ({ execution, ledgered: row.ledgered ?? undefined }),
            ),
          );
        }),
      ),

    shelvedRecords: (incarnation, after, through, limit) =>
      unit(
        Effect.gen(function* () {
          const position = sql<number>`rowid`;
          const owned = yield* db
            .select({ position, execution: executionTable.executionId })
            .from(executionTable)
            .where(
              and(
                eq(executionTable.incarnation, incarnation),
                after === undefined ? undefined : gt(position, after),
                lte(position, through),
                eq(executionTable.phase, 'ended'),
                eq(executionTable.recordAvailability, 'available'),
                eq(executionTable.lifetime, 'command'),
                eq(executionTable.transport, 'pipes'),
              ),
            )
            .orderBy(position)
            .limit(limit);
          const executions = yield* Effect.forEach(owned, (row) =>
            decodeExecutionId(row.execution).pipe(Effect.mapError(unreadable('execution', row.execution))),
          );
          const last = owned.at(-1);
          return { executions, next: owned.length === limit && last !== undefined ? last.position : undefined } satisfies GenerationPage;
        }),
      ),

    retiredGenerations: () =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select({
              incarnation: incarnationTable.incarnation,
              evicting: incarnationTable.evicting,
              execution: executionTable.executionId,
            })
            .from(incarnationTable)
            .leftJoin(executionTable, eq(executionTable.incarnation, incarnationTable.incarnation))
            .where(eq(incarnationTable.current, false))
            .orderBy(asc(incarnationTable.incarnation));
          const retired: Array<{ incarnation: Incarnation; evicting: boolean; executions: Array<ExecutionId> }> = [];
          for (const row of rows) {
            const last = retired.at(-1);
            const generation =
              last !== undefined && last.incarnation === row.incarnation
                ? last
                : { incarnation: row.incarnation, evicting: row.evicting, executions: [] };
            if (generation !== last) retired.push(generation);
            if (row.execution === null) continue;
            generation.executions.push(
              yield* decodeExecutionId(row.execution).pipe(Effect.mapError(unreadable('execution', row.execution))),
            );
          }
          return retired satisfies ReadonlyArray<RetiredGeneration>;
        }),
      ),

    beginEviction: (incarnation) =>
      unit(
        db
          .update(incarnationTable)
          .set({ evicting: true })
          .where(and(eq(incarnationTable.incarnation, incarnation), eq(incarnationTable.current, false))),
      ).pipe(Effect.asVoid),

    retiredLedger: () =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select({
              incarnation: incarnationTable.incarnation,
              evicting: incarnationTable.evicting,
              bytes: generationLedgerTable.bytes,
              pending: generationLedgerTable.pending,
            })
            .from(incarnationTable)
            .leftJoin(generationLedgerTable, eq(generationLedgerTable.incarnation, incarnationTable.incarnation))
            .where(eq(incarnationTable.current, false))
            .orderBy(asc(incarnationTable.incarnation));
          return rows.map((row) => ({
            incarnation: row.incarnation,
            evicting: row.evicting,
            bytes: row.bytes,
            uncertain: row.bytes === null || (row.pending ?? 0) > 0,
          })) satisfies ReadonlyArray<RetiredLedgerEntry>;
        }),
      ),

    noteRecordPending: (incarnation) =>
      unit(
        db
          .insert(generationLedgerTable)
          .values({ incarnation, bytes: 0, pending: 1 })
          .onConflictDoUpdate({
            target: generationLedgerTable.incarnation,
            set: { pending: sql`${generationLedgerTable.pending} + 1` },
          }),
      ).pipe(Effect.asVoid),

    sealRecordBytes: (incarnation, bytes) =>
      unit(
        db
          .insert(generationLedgerTable)
          .values({ incarnation, bytes: Math.max(0, bytes), pending: 0 })
          .onConflictDoUpdate({
            target: generationLedgerTable.incarnation,
            set: {
              bytes: sql`max(0, ${generationLedgerTable.bytes} + ${bytes})`,
              pending: sql`max(0, ${generationLedgerTable.pending} - 1)`,
            },
          }),
      ).pipe(Effect.asVoid),

    setGenerationBytes: (incarnation, bytes) =>
      unit(
        db.run(sql`INSERT INTO generation_ledger (incarnation, bytes, pending)
          VALUES (${incarnation}, max(0, ${bytes}), 0)
          ON CONFLICT (incarnation) DO UPDATE SET bytes = max(0, ${bytes}), pending = 0`),
      ).pipe(Effect.asVoid),

    evictGeneration: Effect.fn('ExecutionStore.evictGeneration')(function* (incarnation) {
      let keyed: EvictionScan = { execution: '', position: 0, scanned: false };
      let rows = 1;
      let envelope = 0;
      while (true) {
        const startedAt = yield* Clock.currentTimeMillis;
        const slice = yield* evictSlice(incarnation, rows, keyed);
        if (slice.done) return;
        keyed = slice.keyed;
        const heldMs = Math.max(1, (yield* Clock.currentTimeMillis) - startedAt);
        envelope = Math.max(envelope, slice.heldBytes / Math.max(1, slice.heldRows));
        const ledger = yield* capacity.ledger();
        const headroom = ledger.granted.grantBytes - ledger.reserved - ledger.retained;
        const ceiling = envelope > 0 ? Math.max(1, Math.floor(headroom / envelope)) : 1;
        rows = Math.min(ceiling, rows * 2, Math.max(1, Math.floor((rows * EVICT_HOLD_MS) / heldMs)));
        yield* Effect.yieldNow;
      }
    }),
  };
};
