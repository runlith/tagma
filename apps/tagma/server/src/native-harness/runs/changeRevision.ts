import { Effect } from 'effect';
import { eq, inArray, sql } from 'drizzle-orm';
import { among } from '../../platform/store/rows.js';
import type { ThreadChangeRevision } from '@runlith/agent/thread/state';
import type { ThreadTransitionStorage } from '@runlith/agent/thread/transition/port';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import { MachineUnits, type ProgramUnit, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { programOf } from '../../platform/store/programs.js';
import { failedAs } from '../../threads/contract/service/failure.js';
import { threadRev } from '../store/thread.js';

type Revisions = Pick<ThreadTransitionStorage<Unit<'machine'>, WriteUnit<'machine'>>, 'revision' | 'opened' | 'revised'>;
type Returning = Parameters<ProgramUnit<'machine'>['returning']>[0];
type ReturnedRows = Parameters<Parameters<ProgramUnit<'machine'>['returning']>[1]>[0];

export const makeChangeRevisions = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const current = db
    .select({ revision: threadRev.changeRev })
    .from(threadRev)
    .where(eq(threadRev.threadId, sql.placeholder('threadId')))
    .prepare();
  const read = (unit: Unit<'machine'>, threadId: string) => Effect.map(unit.run(current.get({ threadId })), (row) => row?.revision ?? 0);
  return {
    revision: (threadId, tx) => failedAs('revision', tx === undefined ? units.read((unit) => read(unit, threadId)) : read(tx, threadId)),
    opened: (threadIds, tx) =>
      threadIds.length === 0
        ? Effect.void
        : failedAs(
            'opened',
            Effect.asVoid(
              tx.run(
                db
                  .update(threadRev)
                  .set({ changeOpen: sql`${threadRev.changeRev}` })
                  .where(inArray(threadRev.threadId, among([...threadIds]))),
              ),
            ),
          ),
    revised: (threadIds, tx, after) =>
      threadIds.length === 0
        ? Effect.void
        : failedAs(
            'revised',
            returned(
              db,
              tx,
              db
                .insert(threadRev)
                .values(threadIds.map((threadId) => ({ threadId, changeRev: 1 })))
                .onConflictDoUpdate({ target: threadRev.threadId, set: { changeRev: sql`${threadRev.changeRev} + 1` } })
                .returning({ threadId: threadRev.threadId, from: threadRev.changeOpen, to: threadRev.changeRev }),
              (rows) => after(revisionsOf(rows)),
            ),
          ),
  } satisfies Revisions;
});

function returned(
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  statement: Returning,
  after: (rows: ReturnedRows) => Effect.Effect<void>,
) {
  const program = programOf(unit);
  if (program !== null) return program.returning(statement, after);
  return Effect.flatMap(unit.run(db.values(statement)), (rows) => unit.afterCommit(after(rows)));
}

function revisionsOf(rows: ReturnedRows): ReadonlyMap<string, ThreadChangeRevision> {
  return new Map(rows.map(([threadId, from, to]) => [String(threadId), { from: Number(from), to: Number(to) }]));
}
