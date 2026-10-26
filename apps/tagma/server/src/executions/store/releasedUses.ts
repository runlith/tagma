import { and, eq, inArray, isNull, notExists } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { rootUse, rootUseHold } from '../../workspace/store/tables.js';
import { command, commandWait, terminal, terminalIntent } from './terminal.js';
import { queried } from './rows.js';

export const forgetReleasedUses = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, ids: readonly string[]) {
  if (ids.length === 0) return 0;
  const rows = yield* queried(
    unit,
    db
      .select({ id: rootUse.useId })
      .from(rootUse)
      .where(
        and(
          inArray(rootUse.useId, [...ids]),
          eq(rootUse.state, 'released'),
          inArray(rootUse.consumerKind, ['command', 'terminal']),
          notExists(db.select().from(terminalIntent).where(eq(terminalIntent.rootUseId, rootUse.useId))),
          notExists(
            db
              .select()
              .from(command)
              .innerJoin(commandWait, eq(commandWait.executionId, command.executionId))
              .where(eq(command.rootUseId, rootUse.useId)),
          ),
          notExists(
            db
              .select()
              .from(terminal)
              .where(and(eq(terminal.rootUseId, rootUse.useId), isNull(terminal.dischargedAt))),
          ),
        ),
      ),
  );
  const gone = rows.map((row) => row.id);
  if (gone.length === 0) return 0;
  yield* queried(unit, db.update(command).set({ rootUseId: null }).where(inArray(command.rootUseId, gone)));
  yield* queried(unit, db.update(terminal).set({ rootUseId: null }).where(inArray(terminal.rootUseId, gone)));
  const holds = yield* queried(unit, db.delete(rootUseHold).where(inArray(rootUseHold.useId, gone)).returning({ id: rootUseHold.useId }));
  yield* queried(unit, db.delete(rootUse).where(inArray(rootUse.useId, gone)));
  return holds.length;
});
