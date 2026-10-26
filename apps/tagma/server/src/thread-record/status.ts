import type { ThreadStatus } from '@runlith/agent/thread/rows';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { Unit } from '../platform/contract/service/units.js';
import { threadRecord } from './store/table.js';
import type { ThreadStatusMove } from './contract/service/records.js';

const standing = { status: threadRecord.status, runningRunId: threadRecord.runningRunId };

const unshelved = { archivedAt: null };

const changeStatus = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, status: ThreadStatus) =>
  Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set(status === 'running' ? { status, ...unshelved } : { status })
        .where(and(eq(threadRecord.id, id), ne(threadRecord.status, status)))
        .returning(standing),
    ),
    (rows) => rows[0],
  );

const changeRun = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, run: NonNullable<ThreadStatusMove['run']>) =>
  Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set(run.to === null ? { runningRunId: null } : { runningRunId: run.to, ...unshelved })
        .where(
          and(
            eq(threadRecord.id, id),
            sql`${threadRecord.runningRunId} is not ${run.to}`,
            run.expected === undefined
              ? undefined
              : run.expected === null
                ? isNull(threadRecord.runningRunId)
                : eq(threadRecord.runningRunId, run.expected),
          ),
        )
        .returning(standing),
    ),
    (rows) => rows[0],
  );

const markMoved = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, at: Date) =>
  Effect.asVoid(
    unit.run(
      db
        .update(threadRecord)
        .set({ movedAt: at })
        .where(and(eq(threadRecord.id, id), sql`${threadRecord.harness} <> 'tagma'`)),
    ),
  );

export const moveStatus = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string, move: ThreadStatusMove) {
  const before =
    move.run === undefined
      ? undefined
      : yield* unit.run(
          db
            .select({ runningRunId: threadRecord.runningRunId, archivedAt: threadRecord.archivedAt })
            .from(threadRecord)
            .where(eq(threadRecord.id, id))
            .get(),
        );
  const status = move.status === undefined ? undefined : yield* changeStatus(db, unit, id, move.status);
  const run = move.run === undefined ? undefined : yield* changeRun(db, unit, id, move.run);
  if (move.movedAt !== undefined) yield* markMoved(db, unit, id, move.movedAt);
  const moved = run ?? status;
  if (moved === undefined) return undefined;
  const unshelved =
    before?.archivedAt != null && ((status !== undefined && move.status === 'running') || (run !== undefined && move.run?.to != null));
  return { ...moved, fromRunId: run === undefined ? moved.runningRunId : (before?.runningRunId ?? null), unshelved };
});
