import { and, asc, eq } from 'drizzle-orm';
import { type Context, Effect } from 'effect';
import { executionPace as paceTable, executionRules as rulesTable, operation as operationTable } from '../db/schema';
import type { ExecutionStore, OpenedStore } from './ExecutionStore';
import { StoredExecutionMissing } from './errors';
import { decodeOperationRef, unreadable } from './records';

type Shape = Context.Service.Shape<typeof ExecutionStore>;

export const timing = (store: OpenedStore): Pick<Shape, 'recordPace' | 'paceOf' | 'recordRules' | 'rulesOf' | 'startOf'> => {
  const { db, unit, owns, executionRow } = store;

  const owned = Effect.fnUntraced(function* (record: { readonly execution: Parameters<typeof owns>[0] }) {
    const row = yield* executionRow(record.execution.execution);
    if (row === undefined) return yield* new StoredExecutionMissing({ execution: record.execution.execution });
    const mismatch = owns(record.execution, row.incarnation);
    if (mismatch !== undefined) return yield* mismatch;
  });

  return {
    recordPace: (record) =>
      unit(
        Effect.gen(function* () {
          yield* owned(record);
          const values = { initial: record.initial, target: record.target, lowered: record.lowered };
          yield* db
            .insert(paceTable)
            .values({ executionId: record.execution.execution, ...values })
            .onConflictDoUpdate({ target: paceTable.executionId, set: values });
        }),
      ),

    paceOf: (execution) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db.select().from(paceTable).where(eq(paceTable.executionId, execution)).limit(1);
          const row = rows[0];
          return row === undefined ? undefined : { initial: row.initial, target: row.target, lowered: row.lowered };
        }),
      ),

    recordRules: (record) =>
      unit(
        Effect.gen(function* () {
          yield* owned(record);
          yield* db
            .insert(rulesTable)
            .values({ executionId: record.execution.execution, bound: record.bound })
            .onConflictDoUpdate({ target: rulesTable.executionId, set: { bound: record.bound } });
        }),
      ),

    startOf: (execution) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select({ installation: operationTable.installation, operationId: operationTable.operationId })
            .from(operationTable)
            .where(and(eq(operationTable.executionId, execution), eq(operationTable.kind, 'receipt')))
            .orderBy(asc(operationTable.createdAt), asc(operationTable.operationId))
            .limit(1);
          const row = rows[0];
          if (row === undefined) return undefined;
          return yield* decodeOperationRef({ installation: row.installation, operation: row.operationId }).pipe(
            Effect.mapError(unreadable('operation', row.operationId)),
          );
        }),
      ),

    rulesOf: (execution) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db.select().from(rulesTable).where(eq(rulesTable.executionId, execution)).limit(1);
          return rows[0]?.bound;
        }),
      ),
  };
};
