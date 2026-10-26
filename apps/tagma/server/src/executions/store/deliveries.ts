import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { Clock, Context, Effect } from 'effect';
import type { ExecutionRef, InstallationId } from '@runlith/executions/protocol/execution';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { CommandDelivery, CommandWaitMode } from '../contract/wire/commands.js';
import { command, commandDelivery, commandWait } from './terminal.js';
import { dischargeDelivery } from './terminalDischarge.js';
import { commandWaitOf, deliveryOf, queried } from './rows.js';

export type CommandDeliveries = ReturnType<typeof makeCommandDeliveries>;

export const CommandDeliveries = Context.Service<CommandDeliveries>('tagma/executions/CommandDeliveries');

export const makeCommandDeliveries = ({ db, installation }: { readonly db: StoreDb<'machine'>; readonly installation: InstallationId }) => {
  const waitOf = Effect.fn('CommandDeliveries.commandWait')(function* (unit: Unit<'machine'>, execution: ExecutionRef) {
    const rows = yield* queried(
      unit,
      db
        .select()
        .from(commandWait)
        .where(and(eq(commandWait.executionId, execution.execution), eq(commandWait.incarnation, execution.incarnation)))
        .all(),
    );
    const row = rows[0];
    return row === undefined ? null : yield* commandWaitOf(execution, row.mode, row.revision);
  });

  return {
    openDelivery: Effect.fn('CommandDeliveries.openDelivery')(function* (unit: WriteUnit<'machine'>, owed: CommandDelivery) {
      yield* queried(
        unit,
        db
          .insert(commandDelivery)
          .values({
            executionId: owed.execution.execution,
            incarnation: owed.execution.incarnation,
            threadId: owed.thread,
            signalId: owed.signalId,
            text: owed.text ?? null,
            openedAt: new Date(owed.openedAt),
          })
          .onConflictDoNothing(),
      );
    }),

    delivery: Effect.fn('CommandDeliveries.delivery')(function* (unit: Unit<'machine'>, execution: ExecutionRef) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(commandDelivery)
          .where(and(eq(commandDelivery.executionId, execution.execution), eq(commandDelivery.incarnation, execution.incarnation)))
          .all(),
      );
      const row = rows[0];
      return row === undefined ? null : yield* deliveryOf(installation, row);
    }),

    deliveriesOwed: Effect.fn('CommandDeliveries.deliveriesOwed')(function* (
      unit: Unit<'machine'>,
      after: { readonly openedAt: number; readonly execution: string } | undefined,
      limit: number,
    ) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(commandDelivery)
          .where(
            after === undefined
              ? undefined
              : or(
                  gt(commandDelivery.openedAt, new Date(after.openedAt)),
                  and(eq(commandDelivery.openedAt, new Date(after.openedAt)), gt(commandDelivery.executionId, after.execution)),
                ),
          )
          .orderBy(asc(commandDelivery.openedAt), asc(commandDelivery.executionId))
          .limit(limit)
          .all(),
      );
      return yield* Effect.forEach(rows, (row) => deliveryOf(installation, row));
    }),

    acceptDelivery: Effect.fn('CommandDeliveries.acceptDelivery')(function* (unit: WriteUnit<'machine'>, execution: ExecutionRef) {
      const settled = yield* queried(
        unit,
        db
          .delete(commandDelivery)
          .where(
            and(
              eq(commandDelivery.executionId, execution.execution),
              eq(commandDelivery.incarnation, execution.incarnation),
              eq(commandDelivery.readers, 0),
            ),
          )
          .returning({ executionId: commandDelivery.executionId }),
      );
      return settled.length > 0;
    }),

    takeDelivery: Effect.fn('CommandDeliveries.takeDelivery')(function* (
      unit: WriteUnit<'machine'>,
      execution: ExecutionRef,
      thread: ThreadId,
    ) {
      const taken = yield* queried(
        unit,
        db
          .update(commandDelivery)
          .set({ readers: sql`${commandDelivery.readers} + 1` })
          .where(
            and(
              eq(commandDelivery.executionId, execution.execution),
              eq(commandDelivery.incarnation, execution.incarnation),
              eq(commandDelivery.threadId, thread),
            ),
          )
          .returning({ executionId: commandDelivery.executionId }),
      );
      return taken.length > 0;
    }),

    releaseDelivery: Effect.fn('CommandDeliveries.releaseDelivery')(function* (unit: WriteUnit<'machine'>, execution: ExecutionRef) {
      const left = yield* queried(
        unit,
        db
          .update(commandDelivery)
          .set({ readers: sql`${commandDelivery.readers} - 1` })
          .where(
            and(
              eq(commandDelivery.executionId, execution.execution),
              eq(commandDelivery.incarnation, execution.incarnation),
              gt(commandDelivery.readers, 0),
            ),
          )
          .returning({ readers: commandDelivery.readers }),
      );
      return left.some((row) => row.readers === 0);
    }),

    releaseClaims: Effect.fn('CommandDeliveries.releaseClaims')(function* (unit: WriteUnit<'machine'>) {
      yield* queried(unit, db.update(commandDelivery).set({ readers: 0 }).where(gt(commandDelivery.readers, 0)));
    }),

    settleDelivery: Effect.fn('CommandDeliveries.settleDelivery')(function* (unit: WriteUnit<'machine'>, execution: ExecutionRef) {
      yield* queried(
        unit,
        db
          .delete(commandDelivery)
          .where(and(eq(commandDelivery.executionId, execution.execution), eq(commandDelivery.incarnation, execution.incarnation))),
      );
    }),

    dischargeDelivery: (unit: WriteUnit<'machine'>, execution: ExecutionRef, thread: ThreadId) =>
      dischargeDelivery(db, unit, execution, thread).pipe(Effect.withSpan('CommandDeliveries.dischargeDelivery')),

    measure: Effect.fn('CommandDeliveries.measure')(function* (unit: WriteUnit<'machine'>, execution: ExecutionRef, words: string) {
      yield* queried(
        unit,
        db
          .update(command)
          .set({ measurement: words })
          .where(and(eq(command.executionId, execution.execution), eq(command.incarnation, execution.incarnation))),
      );
    }),

    measurement: Effect.fn('CommandDeliveries.measurement')(function* (unit: Unit<'machine'>, execution: ExecutionRef) {
      const rows = yield* queried(
        unit,
        db
          .select({ measurement: command.measurement })
          .from(command)
          .where(and(eq(command.executionId, execution.execution), eq(command.incarnation, execution.incarnation)))
          .all(),
      );
      const row = rows[0];
      return row === undefined ? undefined : row.measurement;
    }),

    unmeasured: Effect.fn('CommandDeliveries.unmeasured')(function* (unit: WriteUnit<'machine'>, words: string) {
      yield* queried(
        unit,
        db
          .update(command)
          .set({ measurement: words })
          .where(
            and(
              isNull(command.measurement),
              or(
                inArray(command.executionId, db.select({ id: commandDelivery.executionId }).from(commandDelivery)),
                inArray(command.executionId, db.select({ id: commandWait.executionId }).from(commandWait)),
              ),
            ),
          ),
      );
    }),

    commandWait: waitOf,

    moveCommandWait: Effect.fn('CommandDeliveries.moveCommandWait')(function* (
      unit: WriteUnit<'machine'>,
      execution: ExecutionRef,
      expected: number,
      mode: CommandWaitMode,
    ) {
      const standing = yield* waitOf(unit, execution);
      if (standing === null) return { _tag: 'Ended' as const };
      const moved = yield* queried(
        unit,
        db
          .update(commandWait)
          .set({ mode, revision: expected + 1, movedAt: new Date(yield* Clock.currentTimeMillis) })
          .where(
            and(
              eq(commandWait.executionId, execution.execution),
              eq(commandWait.incarnation, execution.incarnation),
              eq(commandWait.revision, expected),
            ),
          )
          .returning({ revision: commandWait.revision, mode: commandWait.mode }),
      );
      const row = moved[0];
      if (row === undefined) return { _tag: 'Stale' as const, wait: standing };
      return { _tag: 'Moved' as const, wait: yield* commandWaitOf(execution, row.mode, row.revision) };
    }),
  };
};
