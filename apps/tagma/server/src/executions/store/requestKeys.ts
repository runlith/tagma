import { RETAINED_DETAIL_MS, RETAINED_SPENT_MS } from '../contract/wire/requestKeys.js';
import { and, asc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import { Clock, Context, Effect, Schema } from 'effect';
import { type ExecutionRef, type HostRequestKey, type InstallationId } from '@runlith/executions/protocol/execution';
import { UncertainEffect } from '@runlith/executions/protocol/host';
import { InputAnswer } from '@runlith/executions/protocol/input';
import { StopReceipt } from '@runlith/executions/protocol/stop';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { TerminalRefused, type TerminalUnavailable } from '../contract/wire/refusals.js';
import type { TerminalOperationKey, TerminalOperationState } from '../contract/wire/requestKeys.js';
import { commandWait, terminal, terminalRequestKey, terminalRequestKeyTally } from './terminal.js';
import { environmentUse, rootUse } from '../../workspace/store/tables.js';
import { decoded, executionOfKey, queried, requestKeyOf, requestRef, type RequestKeyRow } from './rows.js';
import { INVENTORY_PAGE } from './terminalRows.js';

export const RETAINED_OPERATION_KEYS = 100_000;

const TYPING: ReadonlySet<TerminalOperationKey['mutation']> = new Set(['write', 'interrupt', 'resize']);

const decodeUncertain = Schema.decodeUnknownEffect(Schema.fromJsonString(UncertainEffect));
const decodeInputAnswer = Schema.decodeUnknownEffect(InputAnswer);
const decodeStopReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(StopReceipt));

export type RequestSettlement =
  | {
      readonly _tag: 'Settled';
      readonly executionId?: string;
      readonly incarnation?: number;
      readonly input?: InputAnswer;
      readonly stop?: StopReceipt;
    }
  | { readonly _tag: 'Uncertain'; readonly effect: UncertainEffect };

const matches = (row: RequestKeyRow, key: TerminalOperationKey): boolean => {
  if (row.requester !== key.requester || row.mutation !== key.mutation || row.targetKey !== key.targetKey) {
    return false;
  }
  if (key.execution === undefined) return true;
  return row.executionId === null || (row.executionId === key.execution.execution && row.incarnation === key.execution.incarnation);
};

export type RequestKeys = ReturnType<typeof makeRequestKeys>;

export const RequestKeys = Context.Service<RequestKeys>('tagma/executions/RequestKeys');

export const makeRequestKeys = ({
  db,
  installation,
  retainedKeys,
}: {
  readonly db: StoreDb<'machine'>;
  readonly installation: InstallationId;
  readonly retainedKeys?: number;
}) => {
  const ceiling = retainedKeys ?? RETAINED_OPERATION_KEYS;

  const tally = Effect.fn('RequestKeys.tally')(function* (unit: Unit<'machine'>) {
    const rows = yield* queried(unit, db.select().from(terminalRequestKeyTally).all());
    const counts: Record<RequestKeyRow['outcome'], number> = { pending: 0, admitted: 0, uncertain: 0, settled: 0, expired: 0 };
    for (const row of rows) counts[row.outcome] = row.count;
    return counts;
  });

  const retained = Effect.fn('RequestKeys.retained')(function* (unit: Unit<'machine'>) {
    const counts = yield* tally(unit);
    return counts.pending + counts.admitted + counts.uncertain + counts.settled;
  });

  const row = Effect.fn('RequestKeys.row')(function* (unit: Unit<'machine'>, projectId: number, operationId: HostRequestKey) {
    const rows = yield* queried(
      unit,
      db
        .select()
        .from(terminalRequestKey)
        .where(and(eq(terminalRequestKey.projectId, projectId), eq(terminalRequestKey.operationId, operationId)))
        .all(),
    );
    return rows[0] ?? null;
  });

  const state = Effect.fn('RequestKeys.state')(function* (
    row: RequestKeyRow,
  ): Effect.fn.Return<TerminalOperationState, TerminalUnavailable> {
    const key = requestKeyOf(installation, row);
    const execution = executionOfKey(installation, row);
    switch (row.outcome) {
      case 'pending':
        return { _tag: 'Pending', key };
      case 'admitted':
        return execution === undefined ? { _tag: 'Pending', key } : { _tag: 'Admitted', key, execution };
      case 'settled':
        return {
          _tag: 'Settled',
          key,
          execution: execution,
          input: row.inputOutcome === null ? undefined : yield* decoded(decodeInputAnswer, JSON.parse(row.inputOutcome)),
          stop: row.stopOutcome === null ? undefined : yield* decoded(decodeStopReceipt, row.stopOutcome),
        };
      case 'uncertain':
        return {
          _tag: 'Uncertain',
          key,
          effect:
            row.uncertain === null
              ? { _tag: 'InFlight', operation: requestRef(installation, row.operationId) }
              : yield* decoded(decodeUncertain, row.uncertain),
        };
      case 'expired':
        return { _tag: 'Expired', operation: requestRef(installation, row.operationId), mutation: row.mutation };
    }
  });

  const insert = Effect.fn('RequestKeys.insert')(function* (
    unit: WriteUnit<'machine'>,
    key: TerminalOperationKey,
    hostOperation?: HostRequestKey,
  ) {
    yield* queried(
      unit,
      db.insert(terminalRequestKey).values({
        projectId: key.projectId,
        operationId: key.operationId,
        requester: key.requester,
        mutation: key.mutation,
        targetKey: key.targetKey,
        executionId: key.execution?.execution ?? null,
        incarnation: key.execution?.incarnation ?? null,
        hostOperation: hostOperation ?? null,
        outcome: 'pending',
        uncertain: null,
        at: new Date(yield* Clock.currentTimeMillis),
      }),
    );
    return { _tag: 'Pending', key } satisfies TerminalOperationState;
  });

  const unspent = Effect.fn('RequestKeys.unspent')(function* (unit: WriteUnit<'machine'>, projectId: number, operationId: HostRequestKey) {
    const standing = yield* row(unit, projectId, operationId);
    if (standing?.outcome !== 'expired') return;
    return yield* new TerminalRefused({
      reason: 'operation-expired',
      message: `Operation ${operationId} is a spent key; retention took its receipt and nothing writes over it while it stands.`,
    });
  });

  const expire = Effect.fn('RequestKeys.expire')(function* (unit: WriteUnit<'machine'>, before: number) {
    const expired = (yield* tally(unit)).expired;
    yield* queried(
      unit,
      db
        .update(terminalRequestKey)
        .set({ outcome: 'expired', hostOperation: null, uncertain: null })
        .where(
          and(
            or(
              eq(terminalRequestKey.outcome, 'settled'),
              and(inArray(terminalRequestKey.mutation, [...TYPING]), inArray(terminalRequestKey.outcome, ['pending', 'uncertain'])),
            ),
            lt(terminalRequestKey.at, new Date(before)),
          ),
        ),
    );
    return (yield* tally(unit)).expired - expired;
  });

  const reclaim = Effect.fn('RequestKeys.reclaim')(function* (unit: WriteUnit<'machine'>, before: number) {
    const aged = yield* expire(unit, before);
    const needed = Math.max(0, (yield* retained(unit)) - ceiling + 1);
    if (needed === 0) return aged;
    const victims = sql`(${terminalRequestKey.projectId}, ${terminalRequestKey.operationId}) in (
      select ${terminalRequestKey.projectId}, ${terminalRequestKey.operationId} from ${terminalRequestKey}
      where ${terminalRequestKey.outcome} = 'settled'
      order by ${terminalRequestKey.at}, ${terminalRequestKey.projectId}, ${terminalRequestKey.operationId} limit ${needed}
    )`;
    const rows = yield* queried(
      unit,
      db
        .update(terminalRequestKey)
        .set({ outcome: 'expired', hostOperation: null, uncertain: null })
        .where(victims)
        .returning({ operationId: terminalRequestKey.operationId }),
    );
    return aged + rows.length;
  });

  return {
    register: Effect.fn('RequestKeys.register')(function* (
      unit: WriteUnit<'machine'>,
      key: TerminalOperationKey,
      hostOperation?: HostRequestKey,
    ) {
      const standing = yield* row(unit, key.projectId, key.operationId);
      if (standing !== null) {
        if (standing.outcome === 'expired') {
          return yield* new TerminalRefused({
            reason: 'operation-expired',
            message: `Operation ${key.operationId} is retained as a spent key; its receipt detail is gone and it cannot be taken again until retention forgets it, ${RETAINED_SPENT_MS / 86_400_000} days after it was taken.`,
          });
        }
        if (!matches(standing, key)) {
          return yield* new TerminalRefused({
            reason: 'operation-conflict',
            message: `Operation ${key.operationId} is already taken by a different requester, mutation or target.`,
          });
        }
        if (TYPING.has(key.mutation)) {
          return yield* new TerminalRefused({
            reason: 'operation-conflict',
            message: `Operation ${key.operationId} already names a typing act; read it by its key rather than typing it again.`,
          });
        }
        return yield* state(standing);
      }
      if ((yield* retained(unit)) >= ceiling) {
        yield* reclaim(unit, (yield* Clock.currentTimeMillis) - RETAINED_DETAIL_MS);
        const left = yield* retained(unit);
        if (left < ceiling) return yield* insert(unit, key, hostOperation);
        return yield* new TerminalRefused({
          reason: 'operation-capacity',
          message: `The server's terminal operation store holds ${left} unresolved keys (pending, admitted or uncertain) against its ceiling of ${ceiling}. Settled detail is reclaimed automatically; these keys need their outcomes reconciled before a new mutation can be registered.`,
        });
      }
      return yield* insert(unit, key, hostOperation);
    }),

    startsBefore: Effect.fn('RequestKeys.startsBefore')(function* (
      unit: Unit<'machine'>,
      before: number,
      after?: { readonly projectId: number; readonly operationId: HostRequestKey },
    ) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(terminalRequestKey)
          .where(
            and(
              eq(terminalRequestKey.mutation, 'start'),
              inArray(terminalRequestKey.outcome, ['pending', 'uncertain', 'admitted']),
              lt(terminalRequestKey.at, new Date(before)),
              after === undefined
                ? undefined
                : or(
                    gt(terminalRequestKey.projectId, after.projectId),
                    and(eq(terminalRequestKey.projectId, after.projectId), gt(terminalRequestKey.operationId, after.operationId)),
                  ),
            ),
          )
          .orderBy(asc(terminalRequestKey.projectId), asc(terminalRequestKey.operationId))
          .limit(INVENTORY_PAGE),
      );
      return rows.map((one) => requestKeyOf(installation, one));
    }),

    unspent,

    markUncertain: Effect.fn('RequestKeys.markUncertain')(function* (
      unit: WriteUnit<'machine'>,
      projectId: number,
      operationId: HostRequestKey,
    ) {
      yield* queried(
        unit,
        db
          .update(terminalRequestKey)
          .set({ outcome: 'uncertain' })
          .where(
            and(
              eq(terminalRequestKey.projectId, projectId),
              eq(terminalRequestKey.operationId, operationId),
              inArray(terminalRequestKey.outcome, ['pending']),
            ),
          ),
      );
    }),

    settle: Effect.fn('RequestKeys.settle')(function* (
      unit: WriteUnit<'machine'>,
      projectId: number,
      operationId: HostRequestKey,
      outcome: RequestSettlement,
    ) {
      yield* unspent(unit, projectId, operationId);
      const settled = outcome._tag === 'Settled';
      yield* queried(
        unit,
        db
          .update(terminalRequestKey)
          .set({
            outcome: settled ? 'settled' : 'uncertain',
            ...(settled
              ? {
                  executionId: outcome.executionId,
                  incarnation: outcome.incarnation,
                  inputOutcome: outcome.input === undefined ? undefined : JSON.stringify(outcome.input),
                  stopOutcome: outcome.stop === undefined ? undefined : JSON.stringify(outcome.stop),
                }
              : { uncertain: JSON.stringify(outcome.effect) }),
          })
          .where(and(eq(terminalRequestKey.projectId, projectId), eq(terminalRequestKey.operationId, operationId))),
      );
    }),

    admit: Effect.fn('RequestKeys.admit')(function* (
      unit: WriteUnit<'machine'>,
      projectId: number,
      operationId: HostRequestKey,
      execution: ExecutionRef,
    ) {
      yield* unspent(unit, projectId, operationId);
      yield* queried(
        unit,
        db
          .update(terminalRequestKey)
          .set({
            outcome: 'admitted',
            executionId: execution.execution,
            incarnation: execution.incarnation,
          })
          .where(and(eq(terminalRequestKey.projectId, projectId), eq(terminalRequestKey.operationId, operationId))),
      );
    }),

    operation: Effect.fn('RequestKeys.operation')(function* (unit: Unit<'machine'>, projectId: number, operationId: HostRequestKey) {
      const standing = yield* row(unit, projectId, operationId);
      return standing === null ? ({ _tag: 'Unknown', operation: requestRef(installation, operationId) } as const) : yield* state(standing);
    }),

    keyOf: Effect.fn('RequestKeys.keyOf')(function* (unit: Unit<'machine'>, executionId: string, incarnation: number) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(terminalRequestKey)
          .where(
            and(
              eq(terminalRequestKey.executionId, executionId),
              eq(terminalRequestKey.incarnation, incarnation),
              eq(terminalRequestKey.mutation, 'start'),
            ),
          )
          .all(),
      );
      const first = rows[0];
      return first === undefined ? null : requestKeyOf(installation, first);
    }),

    stopAsked: Effect.fn('RequestKeys.stopAsked')(function* (unit: Unit<'machine'>, execution: ExecutionRef) {
      const rows = yield* queried(
        unit,
        db
          .select({ operationId: terminalRequestKey.operationId })
          .from(terminalRequestKey)
          .where(
            and(
              eq(terminalRequestKey.executionId, execution.execution),
              eq(terminalRequestKey.incarnation, execution.incarnation),
              eq(terminalRequestKey.mutation, 'stop'),
            ),
          )
          .limit(1)
          .all(),
      );
      return rows.length > 0;
    }),

    keyRetention: Effect.fn('RequestKeys.keyRetention')(function* (unit: Unit<'machine'>) {
      const counts = yield* tally(unit);
      return {
        ...counts,
        retained: counts.pending + counts.admitted + counts.uncertain + counts.settled,
        ceiling,
      };
    }),

    reclaim,

    expire,

    forget: Effect.fn('RequestKeys.forget')(function* (unit: WriteUnit<'machine'>, before: number, limit: number) {
      const spent = sql`(${terminalRequestKey.projectId}, ${terminalRequestKey.operationId}) in (
        select ${terminalRequestKey.projectId}, ${terminalRequestKey.operationId} from ${terminalRequestKey}
        where ${terminalRequestKey.outcome} = 'expired' and ${terminalRequestKey.at} < ${before}
          and (${terminalRequestKey.executionId} is null or (
            ${terminalRequestKey.executionId} not in (select ${terminal.executionId} from ${terminal} where ${terminal.dischargedAt} is null)
            and ${terminalRequestKey.executionId} not in (select ${commandWait.executionId} from ${commandWait})))
          and ${terminalRequestKey.operationId} not in (select ${rootUse.consumerId} from ${rootUse} where ${rootUse.state} = 'held')
          and ${terminalRequestKey.operationId} not in (select ${environmentUse.consumerId} from ${environmentUse} where ${environmentUse.outcome} <> 'released')
        order by ${terminalRequestKey.at}, ${terminalRequestKey.projectId}, ${terminalRequestKey.operationId} limit ${limit}
      )`;
      const expired = (yield* tally(unit)).expired;
      yield* queried(unit, db.delete(terminalRequestKey).where(spent));
      return expired - (yield* tally(unit)).expired;
    }),

    recount: Effect.fn('RequestKeys.recount')(function* (unit: WriteUnit<'machine'>) {
      yield* queried(
        unit,
        db.run(sql`
        insert into ${terminalRequestKeyTally} (outcome, count)
        select outcome, count(*) from ${terminalRequestKey} group by outcome
        union all
        select outcome, 0 from ${terminalRequestKeyTally}
        where outcome not in (select distinct outcome from ${terminalRequestKey})
        on conflict (outcome) do update set count = excluded.count
      `),
      );
    }),
  };
};
