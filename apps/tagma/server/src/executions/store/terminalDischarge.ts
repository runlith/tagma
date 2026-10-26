import { and, eq, lt } from 'drizzle-orm';
import { Clock, Deferred, Effect, Ref, Schema } from 'effect';
import { ExecutionId, type ExecutionRef, type InstallationId } from '@runlith/executions/protocol/execution';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { TerminalHoldings } from '../contract/wire/terminals.js';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { command, commandDelivery, commandWait, openTerminal, openTerminalProgress, terminal } from './terminal.js';
import { environmentUse } from '../../workspace/store/tables.js';
import { rootUse } from '../../workspace/store/tables.js';
import { seedReadiness } from './terminalSeeding.js';
import { forgetReleasedUses } from './releasedUses.js';
import { queried } from './rows.js';

export const dischargeTerminal = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  execution: ExecutionRef,
  reason?: string,
) {
  const rows = yield* queried(
    unit,
    db
      .update(terminal)
      .set({
        heldByThread: null,
        dischargedAt: new Date(yield* Clock.currentTimeMillis),
        endedReason: reason,
      })
      .where(and(eq(terminal.executionId, execution.execution), eq(terminal.incarnation, execution.incarnation)))
      .returning({ use: terminal.rootUseId }),
  );
  yield* forgetReleasedUses(
    db,
    unit,
    rows.flatMap((row) => (row.use === null ? [] : [row.use])),
  );
  yield* queried(
    unit,
    db
      .delete(openTerminal)
      .where(and(eq(openTerminal.terminalId, execution.execution), eq(openTerminal.incarnation, execution.incarnation))),
  );
});

export const noteProjected = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, executionId: string) {
  const rows = yield* queried(
    unit,
    db
      .select({
        incarnation: terminal.incarnation,
        dischargedAt: terminal.dischargedAt,
      })
      .from(terminal)
      .where(eq(terminal.executionId, executionId))
      .all(),
  );
  const row = rows[0];
  if (row === undefined || row.dischargedAt !== null) return;
  yield* queried(
    unit,
    db
      .insert(openTerminal)
      .values({ terminalId: executionId, incarnation: row.incarnation })
      .onConflictDoUpdate({ target: openTerminal.terminalId, set: { incarnation: row.incarnation } }),
  );
});

const decodeHoldings = Schema.decodeUnknownEffect(TerminalHoldings);

type HoldingRow = {
  readonly rootUseId: string | null;
  readonly environmentUseId: string | null;
  readonly rootUseState: string | null;
  readonly environmentUseOutcome: string | null;
};

const usesReleased = (row: HoldingRow): boolean =>
  (row.rootUseId === null || row.rootUseState === 'released') &&
  (row.environmentUseId === null || row.environmentUseOutcome === 'released');

const holdingsOf = (row: HoldingRow): Effect.Effect<TerminalHoldings, TerminalUnavailable> =>
  Effect.mapError(
    decodeHoldings({
      rootUse: row.rootUseId ?? undefined,
      environmentUse: row.environmentUseId ?? undefined,
    }),
    (cause) =>
      new TerminalUnavailable({
        owner: 'store',
        message: `A stored terminal record no longer decodes: ${String(cause)}`,
      }),
  );

export const readObligation = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  projectId: number,
  execution: ExecutionRef,
): Effect.fn.Return<
  { readonly kind: 'terminal' | 'command'; readonly holdings: TerminalHoldings; readonly discharged: boolean } | null,
  TerminalUnavailable
> {
  const terminals = yield* queried(
    unit,
    db
      .select({
        rootUseId: terminal.rootUseId,
        environmentUseId: terminal.environmentUseId,
        rootUseState: rootUse.state,
        environmentUseOutcome: environmentUse.outcome,
        heldByThread: terminal.heldByThread,
        dischargedAt: terminal.dischargedAt,
      })
      .from(terminal)
      .leftJoin(rootUse, eq(rootUse.useId, terminal.rootUseId))
      .leftJoin(environmentUse, eq(environmentUse.useId, terminal.environmentUseId))
      .where(
        and(
          eq(terminal.executionId, execution.execution),
          eq(terminal.incarnation, execution.incarnation),
          eq(terminal.projectId, projectId),
        ),
      )
      .all(),
  );
  const held = terminals[0];
  if (held !== undefined) {
    return {
      kind: 'terminal',
      holdings: yield* holdingsOf(held),
      discharged: held.dischargedAt !== null && held.heldByThread === null && usesReleased(held),
    };
  }
  const commands = yield* queried(
    unit,
    db
      .select({
        rootUseId: command.rootUseId,
        environmentUseId: command.environmentUseId,
        rootUseState: rootUse.state,
        environmentUseOutcome: environmentUse.outcome,
        waiting: commandWait.executionId,
      })
      .from(command)
      .leftJoin(commandWait, and(eq(commandWait.executionId, command.executionId), eq(commandWait.incarnation, command.incarnation)))
      .leftJoin(rootUse, eq(rootUse.useId, command.rootUseId))
      .leftJoin(environmentUse, eq(environmentUse.useId, command.environmentUseId))
      .where(
        and(eq(command.executionId, execution.execution), eq(command.incarnation, execution.incarnation), eq(command.projectId, projectId)),
      )
      .all(),
  );
  const owed = commands[0];
  if (owed === undefined) return null;
  return {
    kind: 'command',
    holdings: yield* holdingsOf(owed),
    discharged: owed.waiting === null && usesReleased(owed),
  };
});

export const generationsBelow = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  installation: InstallationId,
  generation: number,
  gate: Deferred.Deferred<void, TerminalUnavailable>,
  seeding: Ref.Ref<boolean>,
) {
  const progress = yield* queried(unit, db.select().from(openTerminalProgress).all());
  const done = progress[0]?.done === 1;
  const readiness = seedReadiness(done, yield* Ref.get(seeding));
  if (readiness === 'wait') {
    yield* Effect.log('open-terminal seeding is incomplete; the replaced-generation sweep waits for it');
    yield* Deferred.await(gate);
  } else if (readiness === 'refuse') {
    return yield* new TerminalRefused({
      reason: 'stale',
      message: 'open-terminal seeding never started in this process, so the replaced-generation sweep has no seeded side table to read',
    });
  }
  const rows = yield* queried(
    unit,
    db
      .select({
        terminalId: openTerminal.terminalId,
        incarnation: openTerminal.incarnation,
      })
      .from(openTerminal)
      .where(lt(openTerminal.incarnation, generation))
      .all(),
  );
  return rows.map((row): ExecutionRef => ({
    installation,
    execution: ExecutionId.make(row.terminalId),
    incarnation: row.incarnation,
  }));
});

export const dischargeDelivery = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, execution: ExecutionRef, thread: ThreadId) =>
  queried(
    unit,
    db
      .delete(commandDelivery)
      .where(
        and(
          eq(commandDelivery.executionId, execution.execution),
          eq(commandDelivery.incarnation, execution.incarnation),
          eq(commandDelivery.threadId, thread),
        ),
      ),
  );

export const dischargeCommand = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  execution: ExecutionRef,
  reason?: string,
) {
  yield* queried(
    unit,
    db.delete(commandWait).where(and(eq(commandWait.executionId, execution.execution), eq(commandWait.incarnation, execution.incarnation))),
  );
  if (reason !== undefined) {
    yield* queried(
      unit,
      db
        .update(command)
        .set({ endedReason: reason })
        .where(and(eq(command.executionId, execution.execution), eq(command.incarnation, execution.incarnation))),
    );
  }
  const rows = yield* queried(
    unit,
    db
      .select({ use: command.rootUseId })
      .from(command)
      .where(and(eq(command.executionId, execution.execution), eq(command.incarnation, execution.incarnation))),
  );
  yield* forgetReleasedUses(
    db,
    unit,
    rows.flatMap((row) => (row.use === null ? [] : [row.use])),
  );
});

export const readEndedReason = (db: StoreDb<'machine'>, unit: Unit<'machine'>, kind: 'terminal' | 'command', executionId: string) => {
  const table = kind === 'terminal' ? terminal : command;
  return Effect.map(
    queried(unit, db.select({ endedReason: table.endedReason }).from(table).where(eq(table.executionId, executionId)).all()),
    (rows) => rows[0]?.endedReason ?? null,
  );
};
