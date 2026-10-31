import { Connections, sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/sqlite-core/effect/session';
import { Cause, Clock, Context, Deferred, Effect, Layer, Option, Result } from 'effect';
import { SqlError } from 'effect/sql/SqlError';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { narrower, type AdmissionPhase, type HostCustody, type Registration } from '@runlith/executions/protocol/registration';
import type { CallDecision } from '@runlith/executions/protocol/call';
import type { CleanupObligation, Refusal, UncertainEffect } from '@runlith/executions/protocol/host';
import type { CustodyRevision, CustodyState } from '@runlith/executions/protocol/custody';
import type { ExecutionId, ExecutionRef, ExecutionState, HostRequestRef, Incarnation } from '@runlith/executions/protocol/execution';
import type { CommandQuery } from '@runlith/executions/protocol/inventory';
import type { NativeProcess } from '@runlith/executions/protocol/launch';
import type { FinalFacts } from '@runlith/executions/protocol/stop';
import { ExecutionCapacity, type CapacityRefused, type ReceiptCountInvalid, type ReservationMissing } from '../ExecutionCapacity';
import { Holder } from '../holder/Holder';
import type {
  CallRecord,
  AcceptedRevisionRequest,
  BoundRuleRecord,
  CommandRevisionRecord,
  OperationKind,
  OperationReceipt,
  PaceRecord,
  RulesRecord,
  StopIntent,
} from '../db/persisted';
import {
  call as callTable,
  callDecision as callDecisionTable,
  commandRevision as commandRevisionTable,
  custody as custodyTable,
  execution as executionTable,
  executionDependency as dependencyTable,
  generationLedger as generationLedgerTable,
  hostCustody as hostCustodyTable,
  incarnation as incarnationTable,
  operation as operationTable,
  spentKey as spentKeyTable,
  stopIntent as stopIntentTable,
} from '../db/schema';
import { custody, type CustodyAcceptance, type CustodyClaim, type StoredCustodyAnswer } from './custody';
import { endings } from './endings';
import { timing } from './timing';
import { departures, type Departed, type Departure, type DepartureLost } from './departure';
import { continuation, type Applied, type Continuation } from './migrationChain';
import {
  CustodyConflict,
  CustodyLost,
  CustodyRefused,
  IncarnationRefused,
  OperationConflict,
  RevisionConflict,
  StoreAhead,
  StoredExecutionMissing,
  StoreLost,
  StoreUnreadable,
  type StoreFailure,
  type StoreOpenFailure,
} from './errors';
import { generations } from './generations';
import {
  decodeAdmissionPhase,
  decodeExecutionId,
  decodeOperationKind,
  decodeOperationRef,
  decodeReceipt,
  decodeRegistration,
  recordFrom,
  revisionFrom,
  unreadable,
  type AdmittedCommand,
  type CallDecided,
  type CommandRevisionSettlement,
  type CustodyMove,
  type ExecutionRecord,
  type GenerationPage,
  type IncarnationRecord,
  type LaunchRequest,
  type OperationEntry,
  type OperationSettlement,
  type UnresolvedStart,
  type RetainedExecution,
  type RetiredGeneration,
  type RetiredLedgerEntry,
  type RecordRemoval,
  type ShelfLedger,
} from './records';

export class ExecutionStore extends Context.Service<
  ExecutionStore,
  {
    readonly incarnation: () => Effect.Effect<IncarnationRecord, StoreLost | StoreUnreadable | StoreFailure>;
    readonly enterPhase: (phase: AdmissionPhase) => Effect.Effect<AdmissionPhase, StoreLost | StoreUnreadable | StoreFailure>;

    readonly hostCustody: () => Effect.Effect<HostCustody, StoreLost | StoreUnreadable | StoreFailure>;
    readonly custodyAnswer: (
      operation: HostRequestRef,
    ) => Effect.Effect<StoredCustodyAnswer, StoreLost | StoreUnreadable | StoreFailure | OperationConflict>;
    readonly acceptCustody: (
      claim: CustodyClaim,
    ) => Effect.Effect<
      CustodyAcceptance,
      | StoreLost
      | CustodyConflict
      | CustodyRefused
      | CustodyLost
      | OperationConflict
      | CapacityRefused
      | ReceiptCountInvalid
      | StoreUnreadable
      | StoreFailure
    >;

    readonly reserve: (
      request: LaunchRequest,
    ) => Effect.Effect<
      OperationSettlement,
      | StoreLost
      | IncarnationRefused
      | OperationConflict
      | CapacityRefused
      | ReservationMissing
      | ReceiptCountInvalid
      | StoreUnreadable
      | StoreFailure
    >;
    readonly refuseStart: (
      operation: HostRequestRef,
      execution: ExecutionRef,
      refusal: Refusal,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | OperationConflict | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly uncertainStart: (
      operation: HostRequestRef,
      execution: ExecutionRef,
      effect: UncertainEffect,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | OperationConflict | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly adoptStart: (
      operation: HostRequestRef,
      state: ExecutionState,
      native: NativeProcess,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | OperationConflict | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly unresolvedStarts: (
      phase: 'reserved' | 'queued',
      after: ExecutionId | undefined,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<UnresolvedStart>, StoreLost | StoreUnreadable | StoreFailure>;
    readonly executionOf: (
      execution: ExecutionId,
    ) => Effect.Effect<ExecutionRecord, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly recordState: (
      state: ExecutionState,
      native: NativeProcess,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | StoredExecutionMissing | StoreFailure>;

    readonly commandPage: (
      query: CommandQuery,
    ) => Effect.Effect<
      { readonly rows: ReadonlyArray<AdmittedCommand>; readonly more: boolean },
      StoreLost | StoreUnreadable | StoreFailure
    >;
    readonly commandsAt: (
      executions: ReadonlyArray<ExecutionId>,
    ) => Effect.Effect<ReadonlyArray<AdmittedCommand>, StoreLost | StoreUnreadable | StoreFailure>;

    readonly custodyOf: (
      execution: ExecutionId,
    ) => Effect.Effect<CustodyState, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly updateCustody: (
      ref: ExecutionRef,
      expected: CustodyRevision,
      move: CustodyMove,
    ) => Effect.Effect<
      CustodyState,
      StoreLost | IncarnationRefused | StoredExecutionMissing | RevisionConflict | StoreUnreadable | StoreFailure
    >;

    readonly settle: (
      entry: OperationEntry,
    ) => Effect.Effect<
      OperationSettlement,
      StoreLost | OperationConflict | CapacityRefused | ReservationMissing | ReceiptCountInvalid | StoreUnreadable | StoreFailure
    >;
    readonly operationOf: (
      operation: HostRequestRef,
    ) => Effect.Effect<OperationEntry | undefined, StoreLost | StoreUnreadable | StoreFailure>;
    readonly operationAnswerOf: (
      operation: HostRequestRef,
    ) => Effect.Effect<OperationEntry | undefined, StoreLost | StoreUnreadable | StoreFailure>;

    readonly recordStop: (
      intent: StopIntent,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | StoredExecutionMissing | OperationConflict | StoreFailure>;
    readonly stopOf: (
      execution: ExecutionId,
    ) => Effect.Effect<StopIntent | undefined, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly stopRequestsOf: (
      execution: ExecutionId,
    ) => Effect.Effect<ReadonlyArray<StopIntent>, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly stopIntentOf: (
      operation: HostRequestRef,
    ) => Effect.Effect<StopIntent | undefined, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly recordFinal: (
      facts: FinalFacts,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | StoredExecutionMissing | StoreFailure>;

    readonly recordRevision: (
      accepted: AcceptedRevisionRequest,
    ) => Effect.Effect<
      CommandRevisionSettlement,
      StoreLost | IncarnationRefused | StoredExecutionMissing | OperationConflict | StoreUnreadable | StoreFailure
    >;
    readonly resolveRevision: (
      operation: HostRequestRef,
      outcome: 'applied' | 'ended',
    ) => Effect.Effect<CommandRevisionRecord, StoreLost | StoreUnreadable | StoreFailure>;
    readonly endRevisionsOf: (execution: ExecutionId) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly revisionOf: (
      execution: ExecutionId,
    ) => Effect.Effect<CommandRevisionRecord | undefined, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly revisionAt: (
      operation: HostRequestRef,
    ) => Effect.Effect<CommandRevisionRecord | undefined, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;

    readonly recordCall: (
      record: CallRecord,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | StoredExecutionMissing | StoreFailure>;
    readonly callOf: (operation: HostRequestRef) => Effect.Effect<CallRecord | undefined, StoreLost | StoreUnreadable | StoreFailure>;
    readonly recordPace: (
      record: PaceRecord,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | StoredExecutionMissing | StoreFailure>;
    readonly paceOf: (
      execution: ExecutionId,
    ) => Effect.Effect<Omit<PaceRecord, 'execution'> | undefined, StoreLost | StoreUnreadable | StoreFailure>;
    readonly startOf: (execution: ExecutionId) => Effect.Effect<HostRequestRef | undefined, StoreLost | StoreUnreadable | StoreFailure>;
    readonly recordRules: (
      record: RulesRecord,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | StoredExecutionMissing | StoreFailure>;
    readonly rulesOf: (
      execution: ExecutionId,
    ) => Effect.Effect<ReadonlyArray<BoundRuleRecord> | undefined, StoreLost | StoreUnreadable | StoreFailure>;
    readonly decide: (
      decision: CallDecision,
    ) => Effect.Effect<CallDecided, StoreLost | IncarnationRefused | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly decisionOf: (operation: HostRequestRef) => Effect.Effect<CallDecision | undefined, StoreLost | StoreUnreadable | StoreFailure>;
    readonly recordDeparture: (
      departed: Departed,
    ) => Effect.Effect<void, StoreLost | IncarnationRefused | StoredExecutionMissing | StoreFailure>;
    readonly recordLoss: (execution: ExecutionId, detail: string) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly departureOf: (
      execution: ExecutionId,
    ) => Effect.Effect<Departure | undefined, StoreLost | StoreUnreadable | DepartureLost | StoreFailure>;
    readonly dropDeparture: (execution: ExecutionId) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly continuedBy: (migrations: string) => Effect.Effect<Continuation, StoreLost | StoreFailure>;
    readonly handover: () => Effect.Effect<void, StoreFailure>;

    readonly finalOf: (
      execution: ExecutionId,
    ) => Effect.Effect<FinalFacts | undefined, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;

    readonly evidenceOf: (
      ref: ExecutionRef,
    ) => Effect.Effect<RetainedExecution, StoreLost | StoredExecutionMissing | StoreUnreadable | StoreFailure>;
    readonly oldestGeneration: () => Effect.Effect<
      Omit<RetiredGeneration, 'executions'> | undefined,
      StoreLost | StoreUnreadable | StoreFailure
    >;
    readonly generationExecutions: (
      incarnation: Incarnation,
      after: number | undefined,
      limit: number,
    ) => Effect.Effect<GenerationPage, StoreLost | StoreUnreadable | StoreFailure>;
    readonly shelfLedger: (incarnation: Incarnation) => Effect.Effect<ShelfLedger, StoreLost | StoreFailure>;
    readonly beginRemoval: (ref: ExecutionRef, ledgered: number | undefined) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly endRemoval: (execution: ExecutionId) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly unfinishedRemovals: (
      incarnation: Incarnation,
    ) => Effect.Effect<ReadonlyArray<RecordRemoval>, StoreLost | StoreUnreadable | StoreFailure>;
    readonly shelvedRecords: (
      incarnation: Incarnation,
      after: number | undefined,
      through: number,
      limit: number,
    ) => Effect.Effect<GenerationPage, StoreLost | StoreUnreadable | StoreFailure>;
    readonly retiredGenerations: () => Effect.Effect<ReadonlyArray<RetiredGeneration>, StoreLost | StoreUnreadable | StoreFailure>;
    readonly retiredLedger: () => Effect.Effect<ReadonlyArray<RetiredLedgerEntry>, StoreLost | StoreUnreadable | StoreFailure>;
    readonly noteRecordPending: (incarnation: Incarnation) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly sealRecordBytes: (incarnation: Incarnation, bytes: number) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly setGenerationBytes: (incarnation: Incarnation, bytes: number) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly beginEviction: (incarnation: Incarnation) => Effect.Effect<void, StoreLost | StoreFailure>;
    readonly evictGeneration: (incarnation: Incarnation) => Effect.Effect<void, StoreLost | StoreFailure>;

    readonly lost: () => Effect.Effect<StoreLost>;
  }
>()('@runlith/execution-host/ExecutionStore') {}

export const executionStore = (
  path: string,
  registration: Registration,
  processes: ProcessPool,
): Layer.Layer<ExecutionStore, StoreOpenFailure | StoreUnreadable, ExecutionCapacity | Holder> =>
  Layer.unwrap(
    Effect.sync(() => {
      const loss = storeLoss();
      const database = Layer.effectDiscard(applyChain).pipe(
        Layer.provideMerge(sqliteProcessLayer({ filename: path, onLost: loss.strike }, processes)),
      );
      return Layer.effect(ExecutionStore, open(registration, loss)).pipe(Layer.provide(database));
    }),
  );

const migrations =
  [new URL('../../drizzle', import.meta.url), new URL('../drizzle', import.meta.url)]
    .map((url) => fileURLToPath(url))
    .find((folder) => existsSync(folder)) ?? fileURLToPath(new URL('../../drizzle', import.meta.url));

let chainFiles: ReturnType<typeof readMigrationFiles> | null = null;
const chain = (): ReturnType<typeof readMigrationFiles> => {
  chainFiles ??= readMigrationFiles({ migrationsFolder: migrations });
  return chainFiles;
};

const applyChain = Effect.gen(function* () {
  const db = yield* makeWithDefaults();
  const ledger = yield* db.all<{ readonly name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`,
  );
  const applied =
    ledger.length === 0 ? [] : yield* db.all<Applied>(sql`select name, hash from __drizzle_migrations order by created_at, id`);
  const continued = continuation(applied, chain());
  if (continued._tag === 'Diverges') return yield* new StoreAhead({ detail: continued.detail });
  yield* db.run(sql`PRAGMA foreign_keys = OFF`);
  yield* migrate(chain(), db._.session);
  yield* db.run(sql`PRAGMA foreign_keys = ON`);
});

type StoreLoss = {
  readonly signal: Deferred.Deferred<StoreLost>;
  readonly strike: (reason: string) => void;
  readonly struck: () => StoreLost | null;
  readonly admitted: (execution: string) => void;
  readonly ended: (execution: string) => void;
  readonly entered: () => void;
  readonly left: () => void;
};

const storeLoss = (): StoreLoss => {
  let reason: string | null = null;
  let cleanup: typeof CleanupObligation.Type = 'none';
  const live = new Set<string>();
  let crossing = 0;
  const signal = Deferred.makeUnsafe<StoreLost>();
  return {
    signal,
    strike: (said) => {
      if (reason !== null) return;
      cleanup = crossing > 0 ? 'unknown' : live.size > 0 ? 'owned' : 'none';
      reason = said;
      Deferred.doneUnsafe(signal, Effect.succeed(new StoreLost({ reason: said, cleanup })));
    },
    struck: () => (reason === null ? null : new StoreLost({ reason, cleanup })),
    admitted: (execution) => {
      live.add(execution);
    },
    ended: (execution) => {
      live.delete(execution);
    },
    entered: () => {
      crossing += 1;
    },
    left: () => {
      crossing = Math.max(0, crossing - 1);
    },
  };
};

const carrierError = (held: unknown): StoreFailure | undefined =>
  held instanceof SqlError || held instanceof EffectDrizzleQueryError ? held : undefined;

const carrierFailure = (cause: Cause.Cause<unknown>): StoreFailure | undefined => {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure)) {
    const held = carrierError(failure.value);
    if (held !== undefined) return held;
  }
  const defect = Cause.findDefect(cause);
  return Result.isSuccess(defect) ? carrierError(defect.success) : undefined;
};

type KeyRow = Omit<typeof operationTable.$inferSelect, 'createdAt'>;

const SPENT: OperationReceipt = {
  _tag: 'Refused',
  refusal: { _tag: 'IncarnationMismatch', reason: 'The host generation that took this key ended; the key cannot be reused.' },
};

const opened = Effect.fn('ExecutionStore.opened')(function* (registration: Registration, loss: StoreLoss) {
  const db = yield* makeWithDefaults();
  const capacity = yield* ExecutionCapacity;
  const holder = yield* Holder;

  const held = yield* db.transaction(() =>
    Effect.gen(function* () {
      const latest = () =>
        db
          .select({ incarnation: incarnationTable.incarnation })
          .from(incarnationTable)
          .orderBy(desc(incarnationTable.incarnation))
          .limit(1);
      let rows: ReadonlyArray<{ incarnation: number }> | undefined;
      let number = yield* holder.generation;
      if (number === undefined) {
        rows = yield* latest();
        number = (rows[0]?.incarnation ?? -1) + 1;
        yield* holder
          .bindGeneration(number)
          .pipe(Effect.mapError((error) => new StoreUnreadable({ record: 'incarnation', key: String(number), reason: error.detail })));
      }
      const current = (yield* db.select().from(incarnationTable).where(eq(incarnationTable.incarnation, number)).limit(1))[0];
      if (current !== undefined) {
        if (!current.current || current.installation !== registration.installation)
          return yield* new StoreUnreadable({
            record: 'incarnation',
            key: String(number),
            reason: 'the holder generation is retired or belongs to another installation',
          });
        yield* db.update(incarnationTable).set({ registration }).where(eq(incarnationTable.incarnation, number));
        return { installation: registration.installation, incarnation: number };
      }
      rows ??= yield* latest();
      if (number !== (rows[0]?.incarnation ?? -1) + 1)
        return yield* new StoreUnreadable({
          record: 'incarnation',
          key: String(number),
          reason: 'the holder generation does not follow the stored generations',
        });
      yield* db
        .update(incarnationTable)
        .set({ current: false, retiredAt: new Date(yield* Clock.currentTimeMillis) })
        .where(eq(incarnationTable.current, true));
      yield* db.insert(incarnationTable).values({
        incarnation: number,
        installation: registration.installation,
        registration,
        phase: 'open',
        current: true,
      });
      yield* db.insert(generationLedgerTable).values({ incarnation: number, bytes: 0 });
      yield* db.insert(hostCustodyTable).values({ installation: registration.installation, revision: 0, epoch: 0 }).onConflictDoNothing();
      return { installation: registration.installation, incarnation: number };
    }),
  );

  const unit = <A, E, R>(work: Effect.Effect<A, E, R>, accounts?: (value: A) => void): Effect.Effect<A, E | StoreLost | StoreFailure, R> =>
    Effect.suspend(() => {
      const struck = loss.struck();
      if (struck !== null) return Effect.fail(struck);
      if (accounts !== undefined) loss.entered();
      let raised: Cause.Cause<E | StoreFailure> | undefined;
      const body = Effect.onError(work, (cause) =>
        Effect.sync(() => {
          raised = cause;
        }),
      );
      return db
        .transaction(() => body)
        .pipe(
          Effect.tap((value) => Effect.sync(() => accounts?.(value))),
          Effect.catchCause((cause): Effect.Effect<never, E | StoreLost | StoreFailure> => {
            const decided = raised ?? cause;
            if (Cause.hasInterrupts(decided)) return Effect.failCause(decided);
            const carrier = carrierFailure(decided);
            if (carrier === undefined) return Effect.failCause(decided);
            return Effect.fail(loss.struck() ?? carrier);
          }),
          Effect.ensuring(Effect.sync(() => (accounts === undefined ? undefined : loss.left()))),
        );
    });

  const owns = (ref: ExecutionRef, stored?: number): IncarnationRefused | undefined => {
    if (ref.installation !== held.installation || ref.incarnation !== held.incarnation) {
      return new IncarnationRefused({ named: ref.incarnation, current: held.incarnation });
    }
    return stored === undefined || stored === held.incarnation
      ? undefined
      : new IncarnationRefused({ named: stored, current: held.incarnation });
  };

  const executionRow = (execution: string) =>
    Effect.map(
      db
        .select()
        .from(executionTable)
        .where(and(eq(executionTable.executionId, execution), eq(executionTable.incarnation, held.incarnation)))
        .limit(1),
      (rows) => rows[0],
    );

  const spentEntry = (operation: HostRequestRef, kind: OperationKind = 'receipt'): KeyRow => ({
    installation: operation.installation,
    operationId: operation.operation,
    incarnation: null,
    kind,
    fingerprint: '',
    receipt: SPENT,
    executionId: null,
  });

  const spentRow = (operation: HostRequestRef) =>
    Effect.map(
      db
        .select({ incarnation: spentKeyTable.incarnation, kind: spentKeyTable.kind })
        .from(spentKeyTable)
        .where(and(eq(spentKeyTable.installation, operation.installation), eq(spentKeyTable.operationId, operation.operation)))
        .limit(1),
      (rows) =>
        rows[0] === undefined
          ? undefined
          : {
              current: rows[0].incarnation === held.incarnation,
              entry: spentEntry(operation, rows[0].kind),
            },
    );

  const receipted = Effect.fn('ExecutionStore.receipted')(function* (operation: HostRequestRef) {
    const revision = yield* db
      .select({ operationId: commandRevisionTable.operationId })
      .from(commandRevisionTable)
      .where(and(eq(commandRevisionTable.installation, operation.installation), eq(commandRevisionTable.operationId, operation.operation)))
      .limit(1);
    if (revision.length > 0) return spentEntry(operation);
    const stop = yield* db
      .select({ operationId: stopIntentTable.operationId })
      .from(stopIntentTable)
      .where(and(eq(stopIntentTable.installation, operation.installation), eq(stopIntentTable.operationId, operation.operation)))
      .limit(1);
    if (stop.length > 0) return spentEntry(operation);
    const call = yield* db
      .select({ operationId: callTable.operationId })
      .from(callTable)
      .where(and(eq(callTable.installation, operation.installation), eq(callTable.operationId, operation.operation)))
      .limit(1);
    if (call.length > 0) return spentEntry(operation);
    const decision = yield* db
      .select({ operationId: callDecisionTable.operationId })
      .from(callDecisionTable)
      .where(and(eq(callDecisionTable.installation, operation.installation), eq(callDecisionTable.operationId, operation.operation)))
      .limit(1);
    return decision.length > 0 ? spentEntry(operation) : undefined;
  });

  const operationRow = Effect.fn('ExecutionStore.operationRow')(function* (operation: HostRequestRef, includeCurrentSpent = true) {
    const rows = yield* db
      .select()
      .from(operationTable)
      .where(and(eq(operationTable.installation, operation.installation), eq(operationTable.operationId, operation.operation)))
      .limit(1);
    const row = rows[0];
    if (row !== undefined) return row.incarnation === held.incarnation ? row : spentEntry(operation, row.kind);
    const spent = yield* spentRow(operation);
    if (spent !== undefined) return spent.current && !includeCurrentSpent ? undefined : spent.entry;
    return yield* receipted(operation);
  });

  const rememberSpent = (operation: HostRequestRef, kind: OperationKind) =>
    db
      .insert(spentKeyTable)
      .values({
        installation: operation.installation,
        operationId: operation.operation,
        incarnation: held.incarnation,
        kind,
      })
      .onConflictDoNothing();

  const revisionRow = (operation: HostRequestRef) =>
    Effect.map(
      db
        .select()
        .from(commandRevisionTable)
        .where(
          and(eq(commandRevisionTable.installation, operation.installation), eq(commandRevisionTable.operationId, operation.operation)),
        )
        .orderBy(asc(commandRevisionTable.revision))
        .limit(1),
      (rows) => rows[0],
    );

  const entryOf = Effect.fn('ExecutionStore.entryOf')(function* (row: KeyRow) {
    const fail = unreadable('operation', row.operationId);
    const operation = yield* decodeOperationRef({
      installation: row.installation,
      operation: row.operationId,
    }).pipe(Effect.mapError(fail));
    const receipt = yield* decodeReceipt(row.receipt).pipe(Effect.mapError(fail));
    const kind = yield* decodeOperationKind(row.kind).pipe(Effect.mapError(fail));
    const execution = row.executionId === null ? undefined : yield* decodeExecutionId(row.executionId).pipe(Effect.mapError(fail));
    return {
      operation,
      kind,
      fingerprint: row.fingerprint,
      receipt,
      execution: execution,
    } satisfies OperationEntry;
  });

  const recordOf = Effect.fn('ExecutionStore.recordOf')(function* (row: typeof executionTable.$inferSelect) {
    const dependencies = yield* db
      .select({ receipt: dependencyTable.receipt })
      .from(dependencyTable)
      .where(eq(dependencyTable.executionId, row.executionId))
      .orderBy(asc(dependencyTable.position));
    return yield* recordFrom(
      row,
      dependencies.map((entry) => entry.receipt),
    );
  });

  return {
    db,
    capacity,
    held,
    struck: loss.struck,
    unit,
    owns,
    executionRow,
    operationRow,
    rememberSpent,
    revisionRow,
    entryOf,
    recordOf,
  };
});

export type OpenedStore = Effect.Success<ReturnType<typeof opened>>;

const open = Effect.fn('ExecutionStore.open')(function* (registration: Registration, loss: StoreLoss) {
  const store = yield* opened(registration, loss);
  const { db, capacity, held, unit, owns, executionRow, operationRow, rememberSpent, revisionRow, entryOf, recordOf } = store;

  const takenBy = (standing: KeyRow, fingerprint: string) =>
    standing.fingerprint !== fingerprint
      ? Effect.fail(new OperationConflict({ operation: standing.operationId }))
      : Effect.map(entryOf(standing), (entry) => ({ _tag: 'Taken', entry }) satisfies OperationSettlement);

  const reserveSpace = (entry: OperationEntry): Effect.Effect<void, CapacityRefused | ReservationMissing | ReceiptCountInvalid> =>
    entry.kind === 'custody'
      ? capacity.reserveCustodyReceipts(1)
      : entry.kind === 'tombstone' || entry.execution === undefined
        ? capacity.reserveTombstone()
        : capacity.reserveReceipt(entry.execution);

  const releaseSpace = (entry: OperationEntry): Effect.Effect<void, ReceiptCountInvalid | ReservationMissing> =>
    entry.kind === 'custody'
      ? capacity.releaseCustodyReceipts(1)
      : entry.kind === 'tombstone' || entry.execution === undefined
        ? capacity.releaseTombstone()
        : capacity.releaseReceipt(entry.execution);

  const charged = <E, R>(entry: OperationEntry, work: Effect.Effect<OperationSettlement, E, R>) =>
    Effect.acquireUseRelease(
      reserveSpace(entry),
      () => work,
      () => Effect.orDie(releaseSpace(entry)),
    );

  const receiptsOf = (rows: ReadonlyArray<typeof executionTable.$inferSelect>) =>
    Effect.map(
      db
        .select({ execution: dependencyTable.executionId, receipt: dependencyTable.receipt })
        .from(dependencyTable)
        .where(
          inArray(
            dependencyTable.executionId,
            rows.map((row) => row.executionId),
          ),
        )
        .orderBy(asc(dependencyTable.executionId), asc(dependencyTable.position)),
      (found) => {
        const receipts = new Map<string, string[]>();
        for (const entry of found) {
          const listed = receipts.get(entry.execution);
          if (listed === undefined) receipts.set(entry.execution, [entry.receipt]);
          else listed.push(entry.receipt);
        }
        return receipts;
      },
    );

  const admittedOf = (rows: ReadonlyArray<typeof executionTable.$inferSelect>) =>
    rows.length === 0
      ? Effect.succeed([])
      : Effect.flatMap(receiptsOf(rows), (receipts) =>
          Effect.forEach(rows, (row) =>
            Effect.map(recordFrom(row, receipts.get(row.executionId) ?? []), (record): AdmittedCommand => ({
              record,
              admittedAtMs: row.createdAt.getTime(),
            })),
          ),
        );

  const commandRows = Effect.fn('ExecutionStore.commandRows')(function* (query: CommandQuery) {
    const rows = yield* db
      .select()
      .from(executionTable)
      .where(
        and(
          eq(executionTable.lifetime, 'command'),
          ...(query.scope === undefined ? [] : [eq(executionTable.commandScope, query.scope)]),
          ...(query.owner === undefined ? [] : [eq(executionTable.commandOwner, query.owner)]),
          ...(query.cohort === undefined ? [] : [eq(executionTable.commandCohort, query.cohort)]),
          ...(query.phases === undefined ? [] : [inArray(executionTable.phase, [...query.phases])]),
          eq(executionTable.incarnation, held.incarnation),
          ...(query.after === undefined
            ? []
            : [
                or(
                  gt(executionTable.createdAt, new Date(query.after.admittedAtMs)),
                  and(
                    eq(executionTable.createdAt, new Date(query.after.admittedAtMs)),
                    gt(executionTable.executionId, query.after.execution),
                  ),
                ),
              ]),
        ),
      )
      .orderBy(asc(executionTable.createdAt), asc(executionTable.executionId))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      rows: yield* admittedOf(page),
      more: rows.length > page.length,
    };
  });

  const commandRowsAt = Effect.fn('ExecutionStore.commandRowsAt')(function* (executions: ReadonlyArray<ExecutionId>) {
    if (executions.length === 0) return [];
    const rows = yield* db
      .select()
      .from(executionTable)
      .where(
        and(
          eq(executionTable.lifetime, 'command'),
          eq(executionTable.incarnation, held.incarnation),
          inArray(executionTable.executionId, [...executions]),
        ),
      )
      .orderBy(asc(executionTable.createdAt), asc(executionTable.executionId));
    return yield* admittedOf(rows);
  });

  const settleStart = (operation: HostRequestRef, execution: ExecutionRef, receipt: OperationReceipt) =>
    unit(
      Effect.gen(function* () {
        const row = yield* executionRow(execution.execution);
        if (row === undefined) return yield* new StoredExecutionMissing({ execution: execution.execution });
        const mismatch = owns(execution, row.incarnation);
        if (mismatch !== undefined) return yield* mismatch;
        const spent = yield* operationRow(operation);
        const pending = row.phase === 'reserved' || row.phase === 'queued';
        if (spent === undefined || spent.executionId !== execution.execution || !pending) {
          return yield* new OperationConflict({ operation: operation.operation });
        }
        const entry = yield* entryOf(spent);
        if (entry.receipt._tag !== 'Accepted' && entry.receipt._tag !== 'Uncertain')
          return yield* new OperationConflict({ operation: operation.operation });
        yield* db
          .update(operationTable)
          .set({ receipt })
          .where(and(eq(operationTable.installation, operation.installation), eq(operationTable.operationId, operation.operation)));
        if (receipt._tag !== 'Refused') return;
        yield* db
          .update(executionTable)
          .set({
            phase: 'ended',
            stdout: 'eof',
            stderr: 'eof',
            pty: 'eof',
            cleanup: 'unverifiable',
            recordAvailability: 'unavailable',
            updatedAt: new Date(yield* Clock.currentTimeMillis),
          })
          .where(eq(executionTable.executionId, execution.execution));
      }),
      () => {
        if (receipt._tag === 'Refused') loss.ended(execution.execution);
      },
    );

  const saveState = Effect.fn('ExecutionStore.saveState')(function* (state: ExecutionState, native: NativeProcess) {
    const row = yield* executionRow(state.ref.execution);
    if (row === undefined) return yield* new StoredExecutionMissing({ execution: state.ref.execution });
    const mismatch = owns(state.ref, row.incarnation);
    if (mismatch !== undefined) return yield* mismatch;
    yield* db
      .update(executionTable)
      .set({
        phase: state.phase,
        nativeExit: state.nativeExit ?? null,
        stdout: state.streams.stdout,
        stderr: state.streams.stderr,
        pty: state.streams.pty,
        cleanup: state.cleanup,
        recordAvailability: state.record,
        pid: native.pid ?? null,
        terminal: native.terminal ?? null,
        updatedAt: new Date(yield* Clock.currentTimeMillis),
      })
      .where(eq(executionTable.executionId, state.ref.execution));
    return state.phase;
  });

  const phaseOf = Effect.fn('ExecutionStore.phaseOf')(function* () {
    const rows = yield* db
      .select({ phase: incarnationTable.phase })
      .from(incarnationTable)
      .where(eq(incarnationTable.incarnation, held.incarnation))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return yield* new StoreUnreadable({
        record: 'incarnation',
        key: String(held.incarnation),
        reason: 'the generation this store entered is no longer in the file',
      });
    }
    return yield* decodeAdmissionPhase(row.phase).pipe(Effect.mapError(unreadable('incarnation', String(held.incarnation))));
  });

  const connections = yield* Connections;

  return ExecutionStore.of({
    ...custody(store),
    ...endings(store),
    ...timing(store),
    ...generations(store),
    ...departures(store),
    handover: () => connections.handover,

    incarnation: () =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db.select().from(incarnationTable).where(eq(incarnationTable.incarnation, held.incarnation)).limit(1);
          const row = rows[0];
          if (row === undefined) {
            return yield* new StoreUnreadable({
              record: 'incarnation',
              key: String(held.incarnation),
              reason: 'the generation this store entered is no longer in the file',
            });
          }
          const fail = unreadable('incarnation', String(row.incarnation));
          const registered = yield* decodeRegistration(row.registration).pipe(Effect.mapError(fail));
          const phase = yield* decodeAdmissionPhase(row.phase).pipe(Effect.mapError(fail));
          return {
            installation: registered.installation,
            incarnation: row.incarnation,
            registration: registered,
            phase,
          } satisfies IncarnationRecord;
        }),
      ),

    enterPhase: (phase) =>
      unit(
        Effect.gen(function* () {
          const standing = yield* phaseOf();
          const next = narrower(standing, phase);
          if (next !== standing) {
            yield* db.update(incarnationTable).set({ phase: next }).where(eq(incarnationTable.incarnation, held.incarnation));
          }
          return next;
        }),
      ),

    reserve: (request) =>
      charged(
        {
          operation: request.operation,
          kind: 'receipt',
          fingerprint: request.fingerprint,
          receipt: request.receipt,
          execution: request.ref.execution,
        },
        unit(
          Effect.gen(function* () {
            const mismatch = owns(request.ref);
            if (mismatch !== undefined) return yield* mismatch;
            if ((yield* revisionRow(request.operation)) !== undefined) {
              return yield* new OperationConflict({ operation: request.operation.operation });
            }
            const spent = yield* operationRow(request.operation);
            if (spent !== undefined) return yield* takenBy(spent, request.fingerprint);

            const taken = yield* db
              .insert(operationTable)
              .values({
                installation: request.operation.installation,
                operationId: request.operation.operation,
                incarnation: held.incarnation,
                kind: 'receipt',
                fingerprint: request.fingerprint,
                receipt: request.receipt,
                executionId: request.ref.execution,
              })
              .onConflictDoNothing()
              .returning({ operationId: operationTable.operationId });
            if (taken.length === 0) {
              const standing = yield* operationRow(request.operation);
              if (standing === undefined) {
                return yield* new StoreUnreadable({
                  record: 'operation',
                  key: request.operation.operation,
                  reason: 'the key neither inserted nor stands',
                });
              }
              if (standing.fingerprint !== request.fingerprint) {
                return yield* new OperationConflict({ operation: request.operation.operation });
              }
              return { _tag: 'Taken', entry: yield* entryOf(standing) } satisfies OperationSettlement;
            }

            yield* rememberSpent(request.operation, 'receipt');
            const pending = yield* db
              .update(generationLedgerTable)
              .set({ pending: sql`${generationLedgerTable.pending} + 1` })
              .where(eq(generationLedgerTable.incarnation, held.incarnation))
              .returning({ incarnation: generationLedgerTable.incarnation });
            if (pending.length !== 1) {
              return yield* new StoreUnreadable({
                record: 'generation-ledger',
                key: String(held.incarnation),
                reason: 'the generation has no byte ledger',
              });
            }
            yield* db.insert(executionTable).values({
              executionId: request.ref.execution,
              installation: request.ref.installation,
              incarnation: request.ref.incarnation,
              transport: request.transport,
              lifetime: request.lifetime,
              purpose: request.purpose,
              phase: request.lifetime === 'command' ? 'queued' : 'reserved',
              command: request.lifetime === 'command' ? request.command : undefined,
              commandScope: request.lifetime === 'command' ? request.command.origin.scope : undefined,
              commandOwner: request.lifetime === 'command' ? request.command.origin.owner : undefined,
              commandCohort: request.lifetime === 'command' ? request.command.origin.cohort : undefined,
              stdout: 'open',
              stderr: 'open',
              pty: 'open',
              cleanup: 'pending',
              recordAvailability: 'available',
              targetEnvironment: request.target.environment,
              targetNamespace: request.target.namespace,
              targetCwd: request.target.cwd,
            });
            if (request.target.dependencies.length > 0) {
              yield* db.insert(dependencyTable).values(
                request.target.dependencies.map((receipt, position) => ({
                  executionId: request.ref.execution,
                  position,
                  receipt,
                })),
              );
            }
            yield* db.insert(custodyTable).values({
              executionId: request.ref.execution,
              revision: 0,
              holder: request.holder,
              origin: request.origin,
            });
            return {
              _tag: 'Recorded',
              entry: {
                operation: request.operation,
                kind: 'receipt',
                fingerprint: request.fingerprint,
                receipt: request.receipt,
                execution: request.ref.execution,
              },
            } satisfies OperationSettlement;
          }),
          (settlement) => {
            if (settlement._tag === 'Recorded') loss.admitted(request.ref.execution);
          },
        ),
      ),

    refuseStart: (operation, execution, refusal) => settleStart(operation, execution, { _tag: 'Refused', refusal }),

    uncertainStart: (operation, execution, effect) => settleStart(operation, execution, { _tag: 'Uncertain', effect }),

    executionOf: (execution) =>
      unit(
        Effect.gen(function* () {
          const row = yield* executionRow(execution);
          if (row === undefined) return yield* new StoredExecutionMissing({ execution });
          return yield* recordOf(row);
        }),
      ),

    commandPage: (query) => unit(commandRows(query)),

    commandsAt: (executions) => unit(commandRowsAt(executions)),

    recordState: (state, native) =>
      Effect.asVoid(
        unit(saveState(state, native), (phase) => {
          if (phase === 'ended') loss.ended(state.ref.execution);
        }),
      ),

    adoptStart: (operation, state, native) =>
      Effect.asVoid(
        unit(
          Effect.gen(function* () {
            const spent = yield* operationRow(operation);
            if (spent === undefined || spent.executionId !== state.ref.execution)
              return yield* new OperationConflict({ operation: operation.operation });
            const entry = yield* entryOf(spent);
            if (entry.receipt._tag !== 'Accepted' && entry.receipt._tag !== 'Uncertain')
              return yield* new OperationConflict({ operation: operation.operation });
            yield* db
              .update(operationTable)
              .set({ receipt: { _tag: 'Accepted', execution: state.ref } })
              .where(and(eq(operationTable.installation, operation.installation), eq(operationTable.operationId, operation.operation)));
            return yield* saveState(state, native);
          }),
          (phase) => {
            if (phase === 'ended') loss.ended(state.ref.execution);
            else loss.admitted(state.ref.execution);
          },
        ),
      ),

    unresolvedStarts: (phase, after, limit) =>
      unit(
        Effect.gen(function* () {
          const tag = sql`json_extract(${operationTable.receipt}, '$._tag')`;
          const rows = yield* db.all<{ readonly installation: string; readonly operation: string; readonly execution: string }>(sql`
            SELECT ${operationTable.installation} AS installation, ${operationTable.operationId} AS operation,
              ${executionTable.executionId} AS execution
            FROM ${executionTable} INDEXED BY execution_phase_idx
            JOIN ${operationTable} ON ${operationTable.executionId} = ${executionTable.executionId}
            WHERE ${executionTable.incarnation} = ${held.incarnation}
              AND ${executionTable.phase} = ${phase} AND ${operationTable.kind} = 'receipt'
              AND (${tag} = 'Uncertain' OR (${executionTable.phase} = 'reserved' AND ${tag} = 'Accepted'))
              AND ${
                after === undefined
                  ? sql`1`
                  : sql`${executionTable}.rowid > (SELECT rowid FROM ${executionTable} WHERE ${executionTable.executionId} = ${after})`
              }
            ORDER BY ${executionTable}.rowid LIMIT ${limit}
          `);
          return yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              return {
                operation: yield* decodeOperationRef({ installation: row.installation, operation: row.operation }).pipe(
                  Effect.mapError(unreadable('operation', row.operation)),
                ),
                execution: {
                  installation: held.installation,
                  incarnation: held.incarnation,
                  execution: yield* decodeExecutionId(row.execution).pipe(Effect.mapError(unreadable('execution', row.execution))),
                },
              };
            }),
          );
        }),
      ),

    settle: (entry) =>
      charged(
        entry,
        unit(
          Effect.gen(function* () {
            if ((yield* revisionRow(entry.operation)) !== undefined) {
              return yield* new OperationConflict({ operation: entry.operation.operation });
            }
            const spent = yield* operationRow(entry.operation);
            if (spent !== undefined) return yield* takenBy(spent, entry.fingerprint);
            const taken = yield* db
              .insert(operationTable)
              .values({
                installation: entry.operation.installation,
                operationId: entry.operation.operation,
                incarnation: held.incarnation,
                kind: entry.kind,
                fingerprint: entry.fingerprint,
                receipt: entry.receipt,
                executionId: entry.execution ?? null,
              })
              .onConflictDoNothing()
              .returning({ operationId: operationTable.operationId });
            if (taken.length > 0) {
              yield* rememberSpent(entry.operation, entry.kind);
              return { _tag: 'Recorded', entry } satisfies OperationSettlement;
            }
            const standing = yield* operationRow(entry.operation);
            if (standing === undefined) {
              return yield* new StoreUnreadable({
                record: 'operation',
                key: entry.operation.operation,
                reason: 'the key neither inserted nor stands',
              });
            }
            if (standing.fingerprint !== entry.fingerprint) {
              return yield* new OperationConflict({ operation: entry.operation.operation });
            }
            return { _tag: 'Taken', entry: yield* entryOf(standing) } satisfies OperationSettlement;
          }),
        ),
      ),

    operationOf: (operation) =>
      unit(
        Effect.gen(function* () {
          const row = yield* operationRow(operation);
          return row === undefined ? undefined : yield* entryOf(row);
        }),
      ),

    operationAnswerOf: (operation) =>
      unit(
        Effect.gen(function* () {
          const row = yield* operationRow(operation, false);
          return row === undefined ? undefined : yield* entryOf(row);
        }),
      ),

    recordRevision: (accepted) =>
      unit(
        Effect.gen(function* () {
          const row = yield* executionRow(accepted.execution.execution);
          if (row === undefined) return yield* new StoredExecutionMissing({ execution: accepted.execution.execution });
          const mismatch = owns(accepted.execution, row.incarnation);
          if (mismatch !== undefined) return yield* mismatch;
          const prior = yield* revisionRow(accepted.operation);
          if (prior === undefined) {
            if ((yield* operationRow(accepted.operation)) !== undefined) {
              return yield* new OperationConflict({ operation: accepted.operation.operation });
            }
          } else if (
            prior.incarnation !== held.incarnation ||
            prior.executionId !== accepted.execution.execution ||
            (yield* operationRow(accepted.operation, false)) !== undefined
          ) {
            return yield* new OperationConflict({ operation: accepted.operation.operation });
          }
          const written = yield* db
            .insert(commandRevisionTable)
            .values({
              executionId: accepted.execution.execution,
              installation: accepted.execution.installation,
              incarnation: accepted.execution.incarnation,
              revision: accepted.revision,
              operationId: accepted.operation.operation,
              fingerprint: accepted.fingerprint,
              executionMs: accepted.executionMs,
              ceilingMs: accepted.ceilingMs ?? null,
              actor: accepted.actor,
              cause: accepted.cause,
              exceptionActor: accepted.exception?.actor ?? null,
              exceptionCause: accepted.exception?.cause ?? null,
              outcome: 'pending',
            })
            .onConflictDoNothing()
            .returning({ revision: commandRevisionTable.revision });
          if (written.length > 0) {
            yield* rememberSpent(accepted.operation, 'receipt');
            return { _tag: 'Recorded' } satisfies CommandRevisionSettlement;
          }
          const standing = yield* revisionFrom(yield* revisionRow(accepted.operation));
          if (standing === undefined) {
            return yield* new StoreUnreadable({
              record: 'command-revision',
              key: accepted.operation.operation,
              reason: 'the revision neither inserted nor stands',
            });
          }
          return { _tag: 'Taken', standing } satisfies CommandRevisionSettlement;
        }),
      ),

    resolveRevision: (operation, outcome) =>
      unit(
        Effect.gen(function* () {
          yield* db
            .update(commandRevisionTable)
            .set({ outcome })
            .where(
              and(
                eq(commandRevisionTable.installation, operation.installation),
                eq(commandRevisionTable.operationId, operation.operation),
                eq(commandRevisionTable.outcome, 'pending'),
              ),
            );
          const standing = yield* revisionFrom(yield* revisionRow(operation));
          if (standing === undefined) {
            return yield* new StoreUnreadable({
              record: 'command-revision',
              key: operation.operation,
              reason: 'the acceptance this outcome belongs to is not in the file',
            });
          }
          return standing;
        }),
      ),

    endRevisionsOf: (execution) =>
      unit(
        Effect.asVoid(
          db
            .update(commandRevisionTable)
            .set({ outcome: 'ended' })
            .where(and(eq(commandRevisionTable.executionId, execution), eq(commandRevisionTable.outcome, 'pending'))),
        ),
      ),

    revisionOf: (execution) =>
      unit(
        Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(commandRevisionTable)
            .where(eq(commandRevisionTable.executionId, execution))
            .orderBy(desc(commandRevisionTable.revision))
            .limit(1);
          return yield* revisionFrom(rows[0]);
        }),
      ),

    revisionAt: (operation) => unit(Effect.flatMap(revisionRow(operation), revisionFrom)),

    lost: () => Deferred.await(loss.signal),
  });
});
