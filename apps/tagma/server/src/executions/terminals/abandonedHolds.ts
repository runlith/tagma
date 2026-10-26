import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { command, commandWait, terminal, terminalRequestKey } from '../store/terminal.js';
import { rootUse } from '../../workspace/store/tables.js';
import { UseId } from '../../workspace/contract/wire/ids.js';
import type { RootUseFailure, UseConsumer } from '../../workspace/contract/wire/uses.js';
import type { RootUses } from '../../workspace/contract/service/roots.js';

export type AbandonedHold = {
  readonly useId: UseId;
  readonly consumer: UseConsumer;
  readonly from: 'terminal' | 'command';
};

export type AbandonedReport = {
  readonly released: readonly UseId[];
  readonly failed: readonly { readonly useId: UseId; readonly reason: string }[];
};

export const collectAbandonedHolds = (
  db: StoreDb<'machine'>,
  units: MachineUnits['Service'],
  namespaceId: string,
): Effect.Effect<readonly AbandonedHold[], StoreFailure> =>
  units.read((unit) =>
    Effect.gen(function* () {
      const deadTerminals = yield* unit.run(
        db
          .select({
            useId: rootUse.useId,
            operationId: terminalRequestKey.operationId,
            executionId: terminal.executionId,
          })
          .from(rootUse)
          .innerJoin(terminal, eq(terminal.rootUseId, rootUse.useId))
          .leftJoin(
            terminalRequestKey,
            and(eq(terminalRequestKey.executionId, terminal.executionId), eq(terminalRequestKey.incarnation, terminal.incarnation)),
          )
          .where(and(eq(rootUse.state, 'held'), eq(rootUse.namespaceId, namespaceId), isNotNull(terminal.dischargedAt)))
          .all(),
      );
      const deadCommands = yield* unit.run(
        db
          .select({
            useId: rootUse.useId,
            operationId: terminalRequestKey.operationId,
            executionId: command.executionId,
          })
          .from(rootUse)
          .innerJoin(command, eq(command.rootUseId, rootUse.useId))
          .leftJoin(commandWait, and(eq(commandWait.executionId, command.executionId), eq(commandWait.incarnation, command.incarnation)))
          .leftJoin(
            terminalRequestKey,
            and(eq(terminalRequestKey.executionId, command.executionId), eq(terminalRequestKey.incarnation, command.incarnation)),
          )
          .where(and(eq(rootUse.state, 'held'), eq(rootUse.namespaceId, namespaceId), isNull(commandWait.executionId)))
          .all(),
      );
      return [
        ...deadTerminals.map((row): AbandonedHold => ({
          useId: UseId.make(row.useId),
          consumer: { kind: 'terminal', id: row.operationId ?? row.executionId },
          from: 'terminal',
        })),
        ...deadCommands.map((row): AbandonedHold => ({
          useId: UseId.make(row.useId),
          consumer: { kind: 'command', id: row.operationId ?? row.executionId },
          from: 'command',
        })),
      ].filter((hold, at, all) => all.findIndex((other) => other.useId === hold.useId) === at);
    }),
  );

export const releaseAbandonedHolds = Effect.fnUntraced(function* (
  uses: RootUses['Service'],
  units: MachineUnits['Service'],
  holds: readonly AbandonedHold[],
): Effect.fn.Return<AbandonedReport, StoreFailure | RootUseFailure> {
  const released: UseId[] = [];
  const failed: { readonly useId: UseId; readonly reason: string }[] = [];
  for (const hold of holds) {
    const done = yield* units.write(writes('releaseAbandonedHolds.done', [rootUse]), (unit) =>
      uses.release(unit, { useId: hold.useId, consumer: hold.consumer, outcome: 'abandoned' }).pipe(
        Effect.as({ collected: false as const }),
        Effect.catchTag('RootUseMissing', (failure) => Effect.succeed({ collected: true as const, reason: failure._tag })),
      ),
    );
    if (done.collected) failed.push({ useId: hold.useId, reason: done.reason });
    else released.push(hold.useId);
  }
  return { released, failed };
});
