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
import { owedCall } from '../store/calls.js';
import { thread, threadRun } from '../store/kernel.js';
import { threadInbox } from '../store/tables.js';

export type EventReads = Effect.Success<typeof makeEventReads>;

const busy = (threadId: string | SQLiteColumn) => sql`(
  exists (select 1 from ${threadInbox} i where i.thread_id = ${threadId} and i.state = 'queued' and coalesce(json_extract(i.body, '$.waits'), 0) = 0)
  or exists (select 1 from ${threadRun} r where r.status = 'running' and r.thread_id in ${subtreeOf(threadId)})
  or exists (select 1 from ${owedCall} o where o.thread_id = ${threadId})
)`;

export const makeEventReads = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return {
    holders: (threadIds: readonly string[]) =>
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
                  archivedAt: threadRecord.archivedAt,
                  status: threadRecord.status,
                  busy: sql<number>`${busy(threadRecord.id)}`,
                })
                .from(threadRecord)
                .where(inArray(threadRecord.id, ids)),
            );
            for (const row of rows) {
              const standing =
                row.archivedAt !== null ? 'gone' : row.busy === 1 ? 'working' : row.status === 'failed' ? 'failed' : 'rested';
              states.set(row.id, { standing, child: row.parentId !== null });
            }
          }
          for (const id of wanted) if (!states.has(id)) states.set(id, { standing: 'gone', child: false });
          return states as ReadonlyMap<string, HolderState>;
        }),
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
      units.read((unit) => Effect.map(unit.run(db.get<{ busy: number }>(sql`select ${busy(threadId)} as busy`)), (row) => row?.busy === 0)),
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
