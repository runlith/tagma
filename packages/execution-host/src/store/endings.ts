import { and, eq } from 'drizzle-orm';
import { Clock, type Context, Effect, Schema } from 'effect';
import { CallDecision } from '@runlith/executions/protocol/call';
import type { ExecutionId } from '@runlith/executions/protocol/execution';
import {
  call as callTable,
  callDecision as callDecisionTable,
  finalFacts as finalFactsTable,
  stopIntent as stopIntentTable,
} from '../db/schema';
import type { ExecutionStore, OpenedStore } from './ExecutionStore';
import { OperationConflict, StoredExecutionMissing, StoreUnreadable } from './errors';
import { decodeCallRecord, finalFrom, stopFrom, unreadable, type CallDecided } from './records';

type Shape = Context.Service.Shape<typeof ExecutionStore>;

const decodeDecision = Schema.decodeUnknownEffect(CallDecision);

export const endings = (
  store: OpenedStore,
): Pick<
  Shape,
  | 'recordStop'
  | 'stopOf'
  | 'stopRequestsOf'
  | 'stopIntentOf'
  | 'recordFinal'
  | 'finalOf'
  | 'recordCall'
  | 'callOf'
  | 'decide'
  | 'decisionOf'
> => {
  const { db, held, unit, owns, executionRow, operationRow, rememberSpent } = store;

  const stopIntentsOf = Effect.fn('ExecutionStore.stopIntentsOf')(function* (execution: ExecutionId) {
    const rows = yield* db
      .select()
      .from(stopIntentTable)
      .where(eq(stopIntentTable.executionId, execution))
      .orderBy(stopIntentTable.requestedAt);
    if (rows.length === 0) return [];
    const named = yield* executionRow(execution);
    if (named === undefined) return yield* new StoredExecutionMissing({ execution });
    return yield* Effect.forEach(rows, (row) => stopFrom(row, named.installation));
  });

  return {
    recordStop: (intent) =>
      unit(
        Effect.gen(function* () {
          const row = yield* executionRow(intent.execution.execution);
          if (row === undefined) return yield* new StoredExecutionMissing({ execution: intent.execution.execution });
          const mismatch = owns(intent.execution, row.incarnation);
          if (mismatch !== undefined) return yield* mismatch;
          const existing = yield* db
            .select()
            .from(stopIntentTable)
            .where(
              and(
                eq(stopIntentTable.installation, intent.operation.installation),
                eq(stopIntentTable.operationId, intent.operation.operation),
              ),
            )
            .limit(1);
          const admitted = existing[0];
          const taken = yield* operationRow(intent.operation);
          if (
            taken !== undefined &&
            !(taken.kind === 'receipt' && (taken.executionId === intent.execution.execution || admitted !== undefined))
          ) {
            return yield* new OperationConflict({ operation: intent.operation.operation });
          }
          if (admitted !== undefined && intent.joined !== undefined) {
            yield* db
              .update(stopIntentTable)
              .set({ joined: intent.joined, coverage: intent.coverage })
              .where(
                and(
                  eq(stopIntentTable.executionId, intent.execution.execution),
                  eq(stopIntentTable.installation, intent.operation.installation),
                  eq(stopIntentTable.operationId, intent.operation.operation),
                ),
              );
          }
          if (admitted?.executionId === intent.execution.execution && admitted.incarnation === intent.execution.incarnation) return;
          yield* db
            .insert(stopIntentTable)
            .values({
              executionId: intent.execution.execution,
              installation: intent.operation.installation,
              operationId: intent.operation.operation,
              incarnation: intent.execution.incarnation,
              cause: intent.cause,
              coverage: intent.coverage,
              requested: intent.requested ?? 'destroy',
              joined: intent.joined ?? false,
            })
            .onConflictDoNothing();
          yield* rememberSpent(intent.operation, 'receipt');
        }),
      ),

    stopOf: (execution) =>
      unit(
        Effect.gen(function* () {
          const intents = yield* stopIntentsOf(execution);
          return intents.find((intent) => intent.joined !== true) ?? intents[0];
        }),
      ),

    stopRequestsOf: (execution) => unit(stopIntentsOf(execution)),

    stopIntentOf: (operation) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(stopIntentTable)
            .where(and(eq(stopIntentTable.installation, operation.installation), eq(stopIntentTable.operationId, operation.operation)))
            .orderBy(stopIntentTable.requestedAt)
            .limit(1);
          const row = rows[0];
          if (row === undefined) return undefined;
          const named = yield* executionRow(row.executionId);
          if (named === undefined) return yield* new StoredExecutionMissing({ execution: row.executionId });
          return yield* stopFrom(row, named.installation);
        }),
      ),

    recordFinal: (facts) =>
      unit(
        Effect.gen(function* () {
          const row = yield* executionRow(facts.execution.execution);
          if (row === undefined) return yield* new StoredExecutionMissing({ execution: facts.execution.execution });
          const mismatch = owns(facts.execution, row.incarnation);
          if (mismatch !== undefined) return yield* mismatch;
          const values = {
            nativeExit: facts.nativeExit ?? null,
            sources: facts.sources,
            cleanup: facts.cleanup,
            retention: facts.retention,
            confirmed: facts.confirmed,
            residual: facts.residual,
            unverifiable: facts.unverifiable,
            streams: facts.streams,
            relation: facts.relation,
            coverage: facts.coverage,
            abandonedOutput: facts.abandonedOutput,
            unacquired: facts.unacquired ?? null,
          };
          yield* db
            .insert(finalFactsTable)
            .values({
              executionId: facts.execution.execution,
              installation: facts.execution.installation,
              incarnation: facts.execution.incarnation,
              ...values,
            })
            .onConflictDoUpdate({ target: finalFactsTable.executionId, set: values });
        }),
      ),

    finalOf: (execution) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(finalFactsTable)
            .where(and(eq(finalFactsTable.executionId, execution), eq(finalFactsTable.incarnation, held.incarnation)))
            .limit(1);
          const row = rows[0];
          if (row === undefined) return undefined;
          const named = yield* executionRow(execution);
          if (named === undefined) return yield* new StoredExecutionMissing({ execution });
          return yield* finalFrom(row);
        }),
      ),

    recordCall: (record) =>
      unit(
        Effect.gen(function* () {
          if (record.execution !== undefined) {
            const row = yield* executionRow(record.execution.execution);
            if (row === undefined) return yield* new StoredExecutionMissing({ execution: record.execution.execution });
            const mismatch = owns(record.execution, row.incarnation);
            if (mismatch !== undefined) return yield* mismatch;
          }
          const values = {
            executionId: record.execution?.execution ?? null,
            budget: record.budget,
            started: record.started ?? null,
            timing: record.timing ?? null,
            sources: record.sources ?? null,
            retention: record.retention ?? null,
            updatedAt: new Date(yield* Clock.currentTimeMillis),
          };
          yield* db
            .insert(callTable)
            .values({
              installation: record.operation.installation,
              operationId: record.operation.operation,
              ...values,
            })
            .onConflictDoUpdate({ target: [callTable.installation, callTable.operationId], set: values });
          yield* rememberSpent(record.operation, 'receipt');
        }),
      ),

    callOf: (operation) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(callTable)
            .where(and(eq(callTable.installation, operation.installation), eq(callTable.operationId, operation.operation)))
            .limit(1);
          const row = rows[0];
          if (row === undefined) return undefined;
          const named = row.executionId === null ? undefined : yield* executionRow(row.executionId);
          return yield* decodeCallRecord({
            operation: { installation: row.installation, operation: row.operationId },
            execution:
              named === undefined
                ? undefined
                : {
                    installation: named.installation,
                    execution: named.executionId,
                    incarnation: named.incarnation,
                  },
            budget: row.budget,
            started: row.started ?? undefined,
            timing: row.timing ?? undefined,
            sources: row.sources ?? undefined,
            retention: row.retention ?? undefined,
          }).pipe(Effect.mapError(unreadable('call', row.operationId)));
        }),
      ),

    decide: (decision) =>
      unit(
        Effect.gen(function* () {
          if (decision.execution !== undefined) {
            const row = yield* executionRow(decision.execution.execution);
            if (row === undefined) return yield* new StoredExecutionMissing({ execution: decision.execution.execution });
            const mismatch = owns(decision.execution, row.incarnation);
            if (mismatch !== undefined) return yield* mismatch;
          }
          const written = yield* db
            .insert(callDecisionTable)
            .values({
              installation: decision.operation.installation,
              operationId: decision.operation.operation,
              decision,
            })
            .onConflictDoNothing()
            .returning({ operationId: callDecisionTable.operationId });
          if (written.length > 0) {
            yield* rememberSpent(decision.operation, 'receipt');
            return { _tag: 'Recorded', decision } satisfies CallDecided;
          }
          const rows = yield* db
            .select()
            .from(callDecisionTable)
            .where(
              and(
                eq(callDecisionTable.installation, decision.operation.installation),
                eq(callDecisionTable.operationId, decision.operation.operation),
              ),
            )
            .limit(1);
          const standing = rows[0];
          if (standing === undefined) {
            return yield* new StoreUnreadable({
              record: 'call-decision',
              key: decision.operation.operation,
              reason: 'the decision neither inserted nor stands',
            });
          }
          return {
            _tag: 'Standing',
            decision: yield* decodeDecision(standing.decision).pipe(Effect.mapError(unreadable('call-decision', standing.operationId))),
          } satisfies CallDecided;
        }),
      ),

    decisionOf: (operation) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(callDecisionTable)
            .where(and(eq(callDecisionTable.installation, operation.installation), eq(callDecisionTable.operationId, operation.operation)))
            .limit(1);
          const row = rows[0];
          if (row === undefined) return undefined;
          return yield* decodeDecision(row.decision).pipe(Effect.mapError(unreadable('call-decision', row.operationId)));
        }),
      ),
  };
};
