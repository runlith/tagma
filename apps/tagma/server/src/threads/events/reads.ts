import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { chunk } from '@runlith/utils/collection';
import { rowsPerStatement } from '../../platform/store/binds.js';
import type { HolderState } from '../../graph/contract/wire/holders.js';
import { Clock, Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { lineageOf, subtreeOf } from '../../thread-record/lineage.js';
import { recordFacts } from '../../thread-record/facts.js';
import { threadRecord } from '../../thread-record/store/table.js';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { answerIdsOf } from '@runlith/agent/collaboration/ThreadEnvelopes';
import { finalWords } from '../list/said.js';
import { OwnWork } from '../contract/service/ownWork.js';
import { thread, threadRun } from '../store/kernel.js';
import { threadInbox } from '../store/tables.js';

export type EventReads = Effect.Success<typeof makeEventReads>;

const busy = (threadId: string | SQLiteColumn, owing: readonly string[]) => sql`(
  exists (select 1 from ${threadInbox} i where i.thread_id in ${subtreeOf(threadId)} and i.state = 'queued' and coalesce(json_extract(i.body, '$.waits'), 0) = 0)
  or exists (select 1 from ${threadRun} r where r.status = 'running' and r.thread_id in ${subtreeOf(threadId)})
  or exists (select 1 from json_each(${JSON.stringify(owing)}) o where o.value in ${subtreeOf(threadId)})
)`;

export const makeEventReads = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const own = yield* OwnWork;

  const owingBelow = Effect.fn('EventReads.owingBelow')(function* (threadIds: readonly string[]) {
    const below = yield* units.read((unit) =>
      unit.run(
        db.all<{ id: string }>(sql`
          with recursive below(id) as (
            select value from json_each(${JSON.stringify(threadIds)})
            union
            select t.id from ${threadRecord} t join below b on t.parent_id = b.id
          )
          select id from below`),
      ),
    );
    const owing: string[] = [];
    for (const ids of chunk(
      below.map((row) => row.id),
      rowsPerStatement(1),
    ))
      owing.push(...(yield* own.owing(ids)));
    return owing;
  });

  return {
    holders: (threadIds: readonly string[]) =>
      Effect.flatMap(owingBelow(threadIds), (owing) =>
        units.read((unit) =>
          Effect.gen(function* () {
            const wanted = [...new Set(threadIds)];
            const states = new Map<string, HolderState>();
            for (const ids of chunk(wanted, rowsPerStatement(1))) {
              const rows = yield* unit.run(
                db
                  .select({
                    id: threadRecord.id,
                    parentId: threadRecord.parentId,
                    spawnRootId: threadRecord.spawnRootId,
                    archivedAt: threadRecord.archivedAt,
                    status: threadRecord.status,
                    busy: sql<number>`${busy(threadRecord.id, owing)}`,
                  })
                  .from(threadRecord)
                  .where(inArray(threadRecord.id, ids)),
              );
              for (const row of rows) {
                const standing =
                  row.archivedAt !== null ? 'gone' : row.busy === 1 ? 'working' : row.status === 'failed' ? 'failed' : 'rested';
                states.set(row.id, { standing, child: row.parentId !== null, team: row.spawnRootId });
              }
            }
            for (const id of wanted) if (!states.has(id)) states.set(id, { standing: 'gone', child: false, team: null });
            return states as ReadonlyMap<string, HolderState>;
          }),
        ),
      ),
    cached: Effect.flatMap(Clock.currentTimeMillis, (now) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: recordFacts.id })
              .from(recordFacts)
              .innerJoin(thread, eq(thread.id, recordFacts.id))
              .where(
                and(
                  isNull(recordFacts.archivedAt),
                  isNull(recordFacts.runningRunId),
                  sql`unixepoch(json_extract(${thread.contextReading}, '$.measuredAt')) + json_extract(${thread.contextReading}, '$.cache.ttlSeconds') > ${Math.floor(now / 1_000)}`,
                ),
              ),
          ),
          (rows) => rows.map((row) => row.id),
        ),
      ),
    ),
    quiet: (threadId: string) =>
      Effect.flatMap(owingBelow([threadId]), (owing) =>
        units.read((unit) =>
          Effect.map(unit.run(db.get<{ busy: number }>(sql`select ${busy(threadId, owing)} as busy`)), (row) => row?.busy === 0),
        ),
      ),
    finalWords: (threadId: string, runId: string) =>
      units.read((unit) =>
        Effect.map(
          unit.run(db.get<{ words: string | null }>(sql`select ${finalWords(threadId, runId)} as words`)),
          (row) => row?.words ?? null,
        ),
      ),
    answered: (requesterId: string, threadId: string, runId: string) =>
      units.read((unit) =>
        Effect.gen(function* () {
          const taken = yield* unit.run(
            db
              .select({ id: threadInbox.id })
              .from(threadInbox)
              .where(
                and(
                  eq(threadInbox.deliveredToRunId, runId),
                  eq(threadInbox.threadId, threadId),
                  eq(threadInbox.kind, 'task'),
                  sql`json_extract(${threadInbox.sender}, '$.threadId') = ${requesterId}`,
                ),
              ),
          );
          if (taken.length === 0) return false;
          const answers = taken.flatMap((request) => answerIdsOf(request.id, runId));
          const found = yield* unit.run(
            db
              .select({ id: threadInbox.id })
              .from(threadInbox)
              .where(and(eq(threadInbox.threadId, requesterId), inArray(threadInbox.id, answers)))
              .limit(1),
          );
          return found.length > 0;
        }),
      ),
    lineage: (threadId: string) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: recordFacts.id })
              .from(recordFacts)
              .where(sql`${recordFacts.id} in ${lineageOf(threadId)}`),
          ),
          (rows) => rows.map((row) => row.id),
        ),
      ),
  };
});
