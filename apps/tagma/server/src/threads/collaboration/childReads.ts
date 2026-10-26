import { and, eq, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { threadRun } from '../store/kernel.js';
import { threadInbox } from '../store/tables.js';

export type ChildReads = {
  readonly reported: (parentId: string, childId: string, runId: string) => Effect.Effect<boolean, StoreFailure>;
};

export const makeChildReads = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const reported = (parentId: string, childId: string, runId: string) =>
    units.read((unit) =>
      Effect.map(
        unit.run(
          db
            .select({ id: threadInbox.id })
            .from(threadInbox)
            .innerJoin(threadRun, eq(threadRun.id, runId))
            .where(
              and(
                eq(threadInbox.threadId, parentId),
                eq(threadInbox.kind, 'envelope'),
                sql`json_extract(${threadInbox.body}, '$.intent') = 'report'`,
                sql`json_extract(${threadInbox.sender}, '$.threadId') = ${childId}`,
                sql`(${threadInbox.id} like ${`%:${runId}`} or (${threadInbox.id} like 'envelope:final:%' and ${threadInbox.occurredAt} between ${threadRun.startedAt} and coalesce(${threadRun.finishedAt}, ${threadInbox.occurredAt})))`,
              ),
            )
            .limit(1),
        ),
        (rows) => rows.length > 0,
      ),
    );
  return { reported } satisfies ChildReads;
});
