import { Effect } from 'effect';
import { eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm';
import type { ThreadChangeRevision } from '@runlith/agent/thread/state';
import type { ThreadTransitionStorage } from '@runlith/agent/thread/transition/port';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type ProgramUnit, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { programOf } from '../../platform/store/programs.js';
import { bindQuery, writePrepared } from '../../platform/store/queries.js';
import { failedAs } from '../../threads/contract/service/failure.js';
import { threadRev } from '../store/thread.js';

type Revisions = Pick<ThreadTransitionStorage<Unit<'machine'>, WriteUnit<'machine'>>, 'revision' | 'opened' | 'revised'>;
type ReturnedRows = Parameters<Parameters<ProgramUnit<'machine'>['returning']>[1]>[0];

const fresh: Record<keyof ReturnType<typeof getTableColumns<typeof threadRev>>, SQL> = {
  threadId: sql`value`,
  foldRev: sql`0`,
  inheritRev: sql`0`,
  changeRev: sql`1`,
  changeOpen: sql`0`,
};

export const makeChangeRevisions = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const current = db
    .select({ revision: threadRev.changeRev })
    .from(threadRev)
    .where(eq(threadRev.threadId, sql.placeholder('threadId')))
    .prepare();
  const listed = sql`(select value from json_each(${sql.placeholder('threadIds')}))`;
  const opening = db
    .update(threadRev)
    .set({ changeOpen: sql`${threadRev.changeRev}` })
    .where(inArray(threadRev.threadId, listed))
    .prepare();
  const revising = db
    .insert(threadRev)
    .select(
      sql`select ${sql.join(
        Object.keys(getTableColumns(threadRev)).map((column) => fresh[column as keyof typeof fresh]),
        sql`, `,
      )} from json_each(${sql.placeholder('threadIds')}) where true`,
    )
    .onConflictDoUpdate({ target: threadRev.threadId, set: { changeRev: sql`${threadRev.changeRev} + 1` } })
    .returning({ threadId: threadRev.threadId, from: threadRev.changeOpen, to: threadRev.changeRev })
    .prepare();
  const read = (unit: Unit<'machine'>, threadId: string) => Effect.map(unit.run(current.get({ threadId })), (row) => row?.revision ?? 0);
  return {
    revision: (threadId, tx) => failedAs('revision', tx === undefined ? units.read((unit) => read(unit, threadId)) : read(tx, threadId)),
    opened: (threadIds, tx) => {
      if (threadIds.length === 0) return Effect.void;
      return failedAs('opened', Effect.asVoid(writePrepared(tx, opening, { threadIds: JSON.stringify(threadIds) })));
    },
    revised: (threadIds, tx, after) => {
      if (threadIds.length === 0) return Effect.void;
      const values = { threadIds: JSON.stringify(threadIds) };
      const program = programOf(tx);
      const settled = (rows: ReturnedRows) => after(revisionsOf(rows));
      return failedAs(
        'revised',
        program === null
          ? Effect.flatMap(tx.run(revising.values(values)), (rows) => tx.afterCommit(settled(rows)))
          : program.returning(bindQuery(revising, values), settled),
      );
    },
  } satisfies Revisions;
});

function revisionsOf(rows: ReturnedRows): ReadonlyMap<string, ThreadChangeRevision> {
  return new Map(rows.map(([threadId, from, to]) => [String(threadId), { from: Number(from), to: Number(to) }]));
}
