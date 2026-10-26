import { and, eq } from 'drizzle-orm';
import { Data, Effect, Schema } from 'effect';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { threadTargetOperation } from './tables.js';

export class ThreadTargetStorageFailed extends Data.TaggedError('ThreadTargetStorageFailed')<{
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Thread target operation ${this.key} cannot be read: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export type ThreadTargetOperationFailure = StoreFailure | ThreadTargetStorageFailed;

export type ThreadTargetOperationStatus = 'pending' | 'selected' | 'failed' | 'applied';

export type ThreadTargetOperation = {
  readonly threadId: string;
  readonly operationKey: string;
  readonly projectId: number;
  readonly payloadDigest: string;
  readonly rootId: string;
  readonly locationRevision: number;
  readonly expectedSelectionRevision: number | null;
  readonly selectionRevision: number;
  readonly expectedGeneration: number | null;
  readonly fromGeneration: number | null;
  readonly creationOperationId: string | null;
  readonly runId: string | null;
  readonly status: ThreadTargetOperationStatus;
  readonly generation: number | null;
  readonly detail: string | null;
};

export type ThreadTargetOperationNew = Omit<ThreadTargetOperation, 'generation' | 'detail'> & {
  readonly generation?: number | null;
  readonly detail?: string | null;
};

type Row = typeof threadTargetOperation.$inferSelect;

const decodeOperation = Schema.decodeUnknownEffect(
  Schema.Struct({
    threadId: Schema.String,
    operationKey: Schema.String,
    projectId: Schema.Number,
    payloadDigest: Schema.String,
    rootId: Schema.String,
    locationRevision: Schema.Number,
    expectedSelectionRevision: Schema.NullOr(Schema.Number),
    selectionRevision: Schema.Number,
    expectedGeneration: Schema.NullOr(Schema.Number),
    fromGeneration: Schema.NullOr(Schema.Number),
    creationOperationId: Schema.NullOr(Schema.String),
    runId: Schema.NullOr(Schema.String),
    status: Schema.Literals(['pending', 'selected', 'failed', 'applied']),
    generation: Schema.NullOr(Schema.Number),
    detail: Schema.NullOr(Schema.String),
  }),
);

const read = (row: Row): Effect.Effect<ThreadTargetOperation, ThreadTargetStorageFailed> =>
  decodeOperation(row).pipe(
    Effect.mapError((cause) => new ThreadTargetStorageFailed({ key: `${row.threadId}/${row.operationKey}`, cause })),
  );

export type ThreadTargetOperationStore = Effect.Success<typeof makeThreadTargetOperationStore>;

export const makeThreadTargetOperationStore = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const of = Effect.fn('ThreadTargetOperationStore.of')(function* (threadId: string, operationKey: string, unit: Unit<'machine'>) {
    const row = yield* unit.run(
      db
        .select()
        .from(threadTargetOperation)
        .where(and(eq(threadTargetOperation.threadId, threadId), eq(threadTargetOperation.operationKey, operationKey)))
        .get(),
    );
    if (row === undefined) return undefined;
    return yield* read(row);
  });
  const insert = Effect.fn('ThreadTargetOperationStore.insert')(function* (operation: ThreadTargetOperationNew, unit: Unit<'machine'>) {
    yield* unit.run(
      db
        .insert(threadTargetOperation)
        .values({
          threadId: operation.threadId,
          operationKey: operation.operationKey,
          projectId: operation.projectId,
          payloadDigest: operation.payloadDigest,
          rootId: operation.rootId,
          locationRevision: operation.locationRevision,
          expectedSelectionRevision: operation.expectedSelectionRevision,
          selectionRevision: operation.selectionRevision,
          expectedGeneration: operation.expectedGeneration,
          fromGeneration: operation.fromGeneration,
          creationOperationId: operation.creationOperationId,
          runId: operation.runId,
          status: operation.status,
          generation: operation.generation ?? null,
          detail: operation.detail ?? null,
        })
        .onConflictDoNothing(),
    );
    const stood = yield* of(operation.threadId, operation.operationKey, unit);
    if (stood === undefined) {
      return yield* new ThreadTargetStorageFailed({
        key: `${operation.threadId}/${operation.operationKey}`,
        cause: new Error('The operation this unit recorded cannot be read back in the same unit.'),
      });
    }
    return stood;
  });
  const settle = Effect.fn('ThreadTargetOperationStore.settle')(function* (
    threadId: string,
    operationKey: string,
    settled: { readonly status: 'applied' | 'failed'; readonly generation?: number | null; readonly detail?: string | null },
    unit: Unit<'machine'>,
  ) {
    yield* unit.run(
      db
        .update(threadTargetOperation)
        .set({
          status: settled.status,
          generation: settled.generation ?? null,
          detail: settled.detail ?? null,
        })
        .where(
          and(
            eq(threadTargetOperation.threadId, threadId),
            eq(threadTargetOperation.operationKey, operationKey),
            eq(threadTargetOperation.status, 'pending'),
          ),
        ),
    );
    const row = yield* of(threadId, operationKey, unit);
    if (row === undefined) return { won: false, row };
    const won =
      row.status === settled.status &&
      (row.generation ?? null) === (settled.generation ?? null) &&
      (row.detail ?? null) === (settled.detail ?? null);
    return { won, row };
  });
  return { of, insert, settle };
});
