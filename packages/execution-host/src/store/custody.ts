import { and, eq } from 'drizzle-orm';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { Clock, type Context, Effect, Schema } from 'effect';
import { SqlError } from 'effect/sql/SqlError';
import {
  HostCustody,
  type ConnectionId,
  type CustodianEpoch,
  type CustodyHolder,
  type HostCustodyRevision,
} from '@runlith/executions/protocol/registration';
import { CustodyState } from '@runlith/executions/protocol/custody';
import type { ExecutionId, HostRequestRef } from '@runlith/executions/protocol/execution';
import { custody as custodyTable, hostCustody as hostCustodyTable, operation as operationTable } from '../db/schema';
import type { ExecutionStore, OpenedStore } from './ExecutionStore';
import {
  CustodyConflict,
  CustodyLost,
  CustodyRefused,
  OperationConflict,
  RevisionConflict,
  StoredExecutionMissing,
  StoreLost,
  StoreUnreadable,
  type StoreFailure,
} from './errors';
import { unreadable, type OperationEntry } from './records';

export type CustodyClaim =
  | {
      readonly _tag: 'Take';
      readonly operation: HostRequestRef;
      readonly expected: HostCustodyRevision;
      readonly connection: ConnectionId;
    }
  | {
      readonly _tag: 'Fence';
      readonly operation: HostRequestRef;
      readonly expected: HostCustodyRevision;
      readonly connection: ConnectionId;
    }
  | {
      readonly _tag: 'Release';
      readonly operation: HostRequestRef;
      readonly expected: HostCustodyRevision;
      readonly epoch: CustodianEpoch;
      readonly holder: CustodyHolder;
    };

export type CustodyAcceptance =
  | { readonly _tag: 'Accepted'; readonly standing: HostCustody }
  | { readonly _tag: 'Standing'; readonly standing: HostCustody; readonly answered: HostCustody };

export type StoredCustodyAnswer = {
  readonly standing: HostCustody;
  readonly answered?: HostCustody;
};

type Shape = Context.Service.Shape<typeof ExecutionStore>;

type Attempt = { written: boolean };

const decodeCustody = Schema.decodeUnknownEffect(CustodyState);
const decodeHostCustody = Schema.decodeUnknownEffect(HostCustody);

const stepped = (value: number): number | undefined => (Number.isSafeInteger(value + 1) ? value + 1 : undefined);

const fingerprintOf = (claim: CustodyClaim): string =>
  claim._tag === 'Take'
    ? `custody:take:${claim.expected}:${claim.connection}`
    : claim._tag === 'Fence'
      ? `custody:fence:${claim.expected}:${claim.connection}`
      : `custody:release:${claim.expected}:${claim.epoch}:${claim.holder.connection}:${claim.holder.incarnation}`;

export const custody = (
  store: OpenedStore,
): Pick<Shape, 'hostCustody' | 'custodyAnswer' | 'acceptCustody' | 'custodyOf' | 'updateCustody'> => {
  const { db, capacity, held, struck, unit, owns, executionRow, operationRow, rememberSpent, revisionRow, entryOf, recordOf } = store;

  const custodyRecord = Effect.fn('ExecutionStore.custodyRecord')(function* (execution: ExecutionId) {
    const row = yield* executionRow(execution);
    if (row === undefined) return yield* new StoredExecutionMissing({ execution });
    const rows = yield* db.select().from(custodyTable).where(eq(custodyTable.executionId, execution)).limit(1);
    const stored = rows[0];
    if (stored === undefined) return yield* new StoredExecutionMissing({ execution });
    const record = yield* recordOf(row);
    return yield* decodeCustody({
      revision: stored.revision,
      holder: stored.holder,
      origin: stored.origin,
      target: record.target,
    }).pipe(Effect.mapError(unreadable('custody', execution)));
  });

  const custodyRow = Effect.fn('ExecutionStore.custodyRow')(function* () {
    const rows = yield* db.select().from(hostCustodyTable).where(eq(hostCustodyTable.installation, held.installation)).limit(1);
    const row = rows[0];
    if (row === undefined) {
      return yield* new StoreUnreadable({
        record: 'host-custody',
        key: held.installation,
        reason: 'the state directory holds no custody record',
      });
    }
    return row;
  });

  const standingOf = (row: typeof hostCustodyTable.$inferSelect) =>
    (row.holderConnection === null) !== (row.holderIncarnation === null)
      ? Effect.fail(
          new StoreUnreadable({
            record: 'host-custody',
            key: held.installation,
            reason: 'the custody record holds half a holder',
          }),
        )
      : decodeHostCustody({
          revision: row.revision,
          epoch: row.epoch,
          holder:
            row.holderConnection === null || row.holderIncarnation === null
              ? undefined
              : { connection: row.holderConnection, incarnation: row.holderIncarnation },
        }).pipe(Effect.mapError(unreadable('host-custody', held.installation)));

  const custodyKeyOf = Effect.fn('ExecutionStore.custodyKeyOf')(function* (operation: HostRequestRef) {
    const standing = yield* Effect.flatMap(custodyRow(), standingOf);
    const row = yield* operationRow(operation);
    return { standing, entry: row === undefined ? undefined : yield* entryOf(row) };
  });

  const answeredBy = (entry: OperationEntry, claim: CustodyClaim, standing: HostCustody) =>
    entry.fingerprint !== fingerprintOf(claim)
      ? Effect.fail(new OperationConflict({ operation: claim.operation.operation }))
      : entry.receipt._tag !== 'CustodyAccepted'
        ? Effect.fail(
            new StoreUnreadable({
              record: 'operation',
              key: claim.operation.operation,
              reason: `a custody key answered as ${entry.receipt._tag}`,
            }),
          )
        : Effect.succeed({ _tag: 'Standing', standing, answered: entry.receipt.custody } satisfies CustodyAcceptance);

  const conditionOf = (claim: CustodyClaim) =>
    claim._tag === 'Release'
      ? and(
          eq(hostCustodyTable.installation, held.installation),
          eq(hostCustodyTable.revision, claim.expected),
          eq(hostCustodyTable.epoch, claim.epoch),
          eq(hostCustodyTable.holderConnection, claim.holder.connection),
          eq(hostCustodyTable.holderIncarnation, claim.holder.incarnation),
        )
      : and(eq(hostCustodyTable.installation, held.installation), eq(hostCustodyTable.revision, claim.expected));

  const nextCustody = (claim: CustodyClaim, standing: HostCustody): Effect.Effect<HostCustody, CustodyRefused> => {
    const revision = stepped(standing.revision);
    const epoch = claim._tag === 'Release' ? standing.epoch : stepped(standing.epoch);
    if (revision === undefined || epoch === undefined) {
      return Effect.fail(new CustodyRefused({ revision: standing.revision, epoch: standing.epoch }));
    }
    return Effect.succeed(
      claim._tag === 'Take'
        ? { revision, epoch, holder: { connection: claim.connection, incarnation: held.incarnation } }
        : { revision, epoch },
    );
  };

  const chargedCustody = <E, R>(work: Effect.Effect<CustodyAcceptance, E, R>) =>
    Effect.acquireUseRelease(
      capacity.reserveCustodyReceipts(1),
      () => work,
      () => Effect.orDie(capacity.releaseCustodyReceipts(1)),
    );

  const accept = (
    claim: CustodyClaim,
    attempt: Attempt,
  ): Effect.Effect<
    CustodyAcceptance,
    CustodyConflict | CustodyRefused | CustodyLost | OperationConflict | StoreLost | StoreUnreadable | StoreFailure
  > =>
    Effect.suspend(() => {
      const lost = struck();
      if (lost !== null) return Effect.fail(lost);
      return unit(
        Effect.gen(function* () {
          const standing = yield* Effect.flatMap(custodyRow(), standingOf);
          const taken = yield* operationRow(claim.operation);
          if (taken !== undefined) return yield* answeredBy(yield* entryOf(taken), claim, standing);
          if ((yield* revisionRow(claim.operation)) !== undefined) {
            return yield* new OperationConflict({ operation: claim.operation.operation });
          }
          if (standing.revision !== claim.expected) {
            return yield* new CustodyConflict({ expected: claim.expected, standing });
          }
          const next = yield* nextCustody(claim, standing);
          attempt.written = true;
          const written = yield* db
            .update(hostCustodyTable)
            .set({
              revision: next.revision,
              epoch: next.epoch,
              holderConnection: next.holder?.connection ?? null,
              holderIncarnation: next.holder?.incarnation ?? null,
              operationId: claim.operation.operation,
              updatedAt: new Date(yield* Clock.currentTimeMillis),
            })
            .where(conditionOf(claim))
            .returning({ installation: hostCustodyTable.installation });
          if (written.length === 0) return yield* new CustodyConflict({ expected: claim.expected, standing });
          yield* db.insert(operationTable).values({
            installation: claim.operation.installation,
            operationId: claim.operation.operation,
            incarnation: held.incarnation,
            kind: 'custody',
            fingerprint: fingerprintOf(claim),
            receipt: { _tag: 'CustodyAccepted', custody: next },
            executionId: null,
          });
          yield* rememberSpent(claim.operation, 'custody');
          return { _tag: 'Accepted', standing: next } satisfies CustodyAcceptance;
        }),
      ).pipe(
        Effect.catchIf(
          (failure): failure is StoreLost | EffectDrizzleQueryError | SqlError =>
            attempt.written && (failure instanceof StoreLost || failure instanceof EffectDrizzleQueryError || failure instanceof SqlError),
          (failure) =>
            Effect.fail(
              new CustodyLost({
                operation: claim.operation,
                reason: failure instanceof StoreLost ? failure.reason : String(failure),
              }),
            ),
        ),
      );
    });

  return {
    hostCustody: () => unit(Effect.flatMap(custodyRow(), standingOf)),

    custodyAnswer: (operation) =>
      unit(
        Effect.flatMap(custodyKeyOf(operation), ({ standing, entry }) => {
          if (entry === undefined) return Effect.succeed({ standing } satisfies StoredCustodyAnswer);
          if (entry.receipt._tag === 'CustodyAccepted') {
            return Effect.succeed({ standing, answered: entry.receipt.custody } satisfies StoredCustodyAnswer);
          }
          return Effect.fail(new OperationConflict({ operation: operation.operation }));
        }),
      ),

    acceptCustody: Effect.fn('ExecutionStore.acceptCustody')(function* (claim) {
      const found = yield* unit(custodyKeyOf(claim.operation));
      if (found.entry !== undefined) return yield* answeredBy(found.entry, claim, found.standing);
      const attempt: Attempt = { written: false };
      return yield* chargedCustody(accept(claim, attempt));
    }),

    custodyOf: (execution) => unit(custodyRecord(execution)),

    updateCustody: (ref, expected, move) =>
      unit(
        Effect.gen(function* () {
          const row = yield* executionRow(ref.execution);
          if (row === undefined) return yield* new StoredExecutionMissing({ execution: ref.execution });
          const mismatch = owns(ref, row.incarnation);
          if (mismatch !== undefined) return yield* mismatch;
          const written = yield* db
            .update(custodyTable)
            .set({
              revision: expected + 1,
              holder: move.holder,
              updatedAt: new Date(yield* Clock.currentTimeMillis),
            })
            .where(and(eq(custodyTable.executionId, ref.execution), eq(custodyTable.revision, expected)))
            .returning({ executionId: custodyTable.executionId });
          if (written.length === 0) return yield* new RevisionConflict({ execution: ref.execution, expected });
          return yield* custodyRecord(ref.execution);
        }),
      ),
  };
};
