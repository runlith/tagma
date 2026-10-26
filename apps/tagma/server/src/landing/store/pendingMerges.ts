import { and, eq, lte } from 'drizzle-orm';
import { Effect, Option, Schema } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { actorOfPrincipal, principalOf } from '../../executions/terminals/principals.js';
import { worktreePendingMerge } from './tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { FinishRefusalRow } from '../../worktrees/contract/wire/failures.js';
import type { MergeAfter, MergeMode, PendingMerge } from '../../worktrees/contract/wire/mergeTypes.js';

export type PendingRecord = {
  readonly rootId: RootId;
  readonly projectId: number;
  readonly mode: MergeMode;
  readonly message: string | null;
  readonly after: MergeAfter;
  readonly state: 'waiting' | 'stopped';
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly refusal: FinishRefusalRow | null;
  readonly stoppedOn: string | null;
  readonly end: Principal | null;
  readonly caller: TerminalActor | null;
};

const decodeRefusal = Schema.decodeUnknownOption(Schema.fromJsonString(FinishRefusalRow));

const recordOf = (row: typeof worktreePendingMerge.$inferSelect): PendingRecord => ({
  rootId: row.rootId as RootId,
  projectId: row.projectId,
  mode: row.mode,
  message: row.message,
  after: row.after,
  state: row.state,
  queuedAt: row.queuedAt,
  attempts: row.attempts,
  refusal: row.refusal === null ? null : Option.getOrNull(decodeRefusal(row.refusal)),
  stoppedOn: row.stoppedOn,
  end: row.endRunning === null ? null : Principal.make(row.endRunning),
  caller: row.caller === null ? null : actorOfPrincipal(Principal.make(row.caller), row.callerProjectId ?? row.projectId),
});

export const pendingOf = (record: PendingRecord): PendingMerge => ({
  rootId: record.rootId,
  mode: record.mode,
  message: record.message,
  after: record.after,
  state: record.state,
  queuedAt: record.queuedAt.toISOString(),
  attempts: record.attempts,
  refusal: record.refusal,
  endRunning: record.end !== null,
});

export const pendingMergeStore = (db: StoreDb<'machine'>) => ({
  byRoot: Effect.fn('PendingMergeStore.byRoot')(function* (
    rootId: RootId,
    unit: Unit<'machine'>,
  ): Effect.fn.Return<PendingRecord | null, StoreFailure> {
    const row = yield* unit.run(db.select().from(worktreePendingMerge).where(eq(worktreePendingMerge.rootId, rootId)).get());
    return row === undefined ? null : recordOf(row);
  }),

  ofProject: Effect.fn('PendingMergeStore.ofProject')(function* (
    projectId: number,
    unit: Unit<'machine'>,
  ): Effect.fn.Return<readonly PendingRecord[], StoreFailure> {
    const rows = yield* unit.run(db.select().from(worktreePendingMerge).where(eq(worktreePendingMerge.projectId, projectId)).all());
    return rows.map(recordOf);
  }),

  all: Effect.fn('PendingMergeStore.all')(function* (unit: Unit<'machine'>): Effect.fn.Return<readonly PendingRecord[], StoreFailure> {
    const rows = yield* unit.run(db.select().from(worktreePendingMerge).all());
    return rows.map(recordOf);
  }),

  put: Effect.fn('PendingMergeStore.put')(function* (
    record: PendingRecord,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, StoreFailure> {
    const values = {
      rootId: record.rootId,
      projectId: record.projectId,
      mode: record.mode,
      message: record.message,
      after: record.after,
      state: record.state,
      queuedAt: record.queuedAt,
      attempts: record.attempts,
      refusal: record.refusal === null ? null : JSON.stringify(record.refusal),
      stoppedOn: record.stoppedOn,
      endRunning: record.end,
      caller: record.caller === null ? null : principalOf(record.caller),
      callerProjectId: record.caller === null || record.caller._tag === 'Operator' ? null : record.caller.projectId,
    };
    yield* unit.run(
      db.insert(worktreePendingMerge).values(values).onConflictDoUpdate({ target: worktreePendingMerge.rootId, set: values }),
    );
  }),

  replace: Effect.fn('PendingMergeStore.replace')(function* (
    read: PendingRecord,
    next: PendingRecord | null,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<boolean, StoreFailure> {
    const standing = and(
      eq(worktreePendingMerge.rootId, read.rootId),
      eq(worktreePendingMerge.queuedAt, read.queuedAt),
      eq(worktreePendingMerge.attempts, read.attempts),
    );
    const touched =
      next === null
        ? yield* unit.run(db.delete(worktreePendingMerge).where(standing).returning({ rootId: worktreePendingMerge.rootId }).all())
        : yield* unit.run(
            db
              .update(worktreePendingMerge)
              .set({
                state: next.state,
                attempts: next.attempts,
                refusal: next.refusal === null ? null : JSON.stringify(next.refusal),
                stoppedOn: next.stoppedOn,
              })
              .where(standing)
              .returning({ rootId: worktreePendingMerge.rootId })
              .all(),
          );
    return touched.length > 0;
  }),

  dropAsked: Effect.fn('PendingMergeStore.dropAsked')(function* (
    rootId: RootId,
    asked: Date,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<boolean, StoreFailure> {
    const gone = yield* unit.run(
      db
        .delete(worktreePendingMerge)
        .where(and(eq(worktreePendingMerge.rootId, rootId), lte(worktreePendingMerge.queuedAt, asked)))
        .returning({ rootId: worktreePendingMerge.rootId })
        .all(),
    );
    return gone.length > 0;
  }),

  drop: Effect.fn('PendingMergeStore.drop')(function* (
    rootId: RootId,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<boolean, StoreFailure> {
    const gone = yield* unit.run(
      db
        .delete(worktreePendingMerge)
        .where(eq(worktreePendingMerge.rootId, rootId))
        .returning({ rootId: worktreePendingMerge.rootId })
        .all(),
    );
    return gone.length > 0;
  }),
});

export type PendingMergeStore = ReturnType<typeof pendingMergeStore>;
