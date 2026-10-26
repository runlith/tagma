import { Clock, Context, Effect } from 'effect';
import { mintCursor, readCursor } from '@runlith/paging';
import { THREAD_LIST, type ThreadDirectoryRow, type ThreadListQuery } from '@runlith/agent/collaboration/threads';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '@runlith/agent/thread/storage/runs';
import { parseThreadContextReading, parseThreadRunFailure } from '@runlith/agent/thread/persisted';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { currentRunOf } from '@runlith/agent/thread/state';
import { agentTypeId } from '@runlith/agent/thread/agents/AgentProfile';
import type { Cursor } from '@runlith/paging';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { thread, threadRun } from './kernel.js';
import { recordFacts, recordsAs } from '../../thread-record/facts.js';
import { stored } from '../../platform/store/crossing.js';
import { LEASE_RHYTHM } from '../contract/wire/rhythm.js';
import { nativeAsk } from '../list/pendingAsk.js';

export class ThreadDirectory extends Context.Service<
  ThreadDirectory,
  {
    list(
      query: ThreadListQuery,
    ): Effect.Effect<
      { readonly rows: readonly ThreadDirectoryRow[]; readonly total: number; readonly cursor: Cursor | null },
      ThreadStorageFailed
    >;
  }
>()('tagma/threads/ThreadDirectory') {}

export const makeThreadDirectory = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  return ThreadDirectory.of({
    list: (query) => {
      if (query.ids?.length === 0) return Effect.succeed({ rows: [], total: 0, cursor: null });
      const moved = () => sql<number>`coalesce(${thread.updatedAt}, ${recordFacts.movedAt}, ${recordFacts.createdAt})`;
      const movedMs = moved();
      const movedAt = moved().mapWith(thread.updatedAt);
      const scope = and(
        eq(recordFacts.principalId, query.principal),
        isNotNull(recordFacts.projectId),
        isNull(recordFacts.archivedAt),
        query.ids ? inArray(recordFacts.id, [...query.ids]) : undefined,
        query.parent === undefined ? undefined : eq(recordFacts.parentId, query.parent),
        sql`exists (select 1 from ${recordsAs('r')} where r.id = ${query.from} and r.principal_id = ${query.principal})`,
      );
      const life = sql<number>`case
      when ${threadRun.status} = 'running' then
        case when json_extract(${threadRun.progress}, '$.stage') = ${THREAD_RUN_AWAITING_QUESTION_STAGE} then 1 else 0 end
      else 2 end`;
      const reading = query.cursor === undefined ? null : readCursor(query.cursor, THREAD_LIST);
      const after = reading !== null && 'at' in reading ? (reading.at as readonly [number, number, string]) : null;
      const past =
        after === null
          ? undefined
          : or(
              gt(life, after[0]),
              and(eq(life, after[0]), or(lt(movedMs, after[1]), and(eq(movedMs, after[1]), lt(recordFacts.id, after[2])))),
            );
      return stored('threads.list')(
        units.read(
          Effect.fnUntraced(function* (unit) {
            const totals = yield* unit.run(
              db.select({ total: count() }).from(recordFacts).leftJoin(thread, eq(thread.id, recordFacts.id)).where(scope),
            );
            const rows = yield* unit.run(
              db
                .select({
                  threadId: recordFacts.id,
                  projectId: recordFacts.projectId,
                  agentId: recordFacts.agentId,
                  profileId: sql<string | null>`json_extract(${thread.profile}, '$.id')`,
                  hostedAgent: sql<string | null>`json_extract(${thread.transport}, '$.agent')`,
                  name: recordFacts.name,
                  spawnRootId: recordFacts.spawnRootId,
                  parentThreadId: recordFacts.parentId,
                  spawnedByRunId: recordFacts.spawnedByRunId,
                  movedAt,
                  provider: thread.provider,
                  model: thread.model,
                  reasoning: thread.reasoning,
                  account: thread.account,
                  contextReading: thread.contextReading,
                  capabilities: thread.capabilities,
                  pendingInteraction: thread.pendingInteraction,
                  life,
                  runId: threadRun.id,
                  runStatus: threadRun.status,
                  startedAt: threadRun.startedAt,
                  heartbeatAt: threadRun.heartbeatAt,
                  handedOverAt: threadRun.handedOverAt,
                  progress: threadRun.progress,
                  failureReason: threadRun.failureReason,
                  failure: threadRun.failure,
                })
                .from(recordFacts)
                .innerJoin(thread, eq(thread.id, recordFacts.id))
                .leftJoin(
                  threadRun,
                  sql`${threadRun.id} = (
                  select id from ${threadRun}
                  where ${threadRun.threadId} = ${recordFacts.id}
                  order by ${threadRun.createdAt} desc, ${threadRun.id} desc
                  limit 1
                )`,
                )
                .where(and(scope, past))
                .orderBy(asc(life), desc(movedAt), desc(recordFacts.id))
                .limit(query.limit + 1),
            );
            const page = rows.slice(0, query.limit);
            const last = page.at(-1);
            const now = new Date(yield* Clock.currentTimeMillis);
            return {
              total: totals[0]?.total ?? 0,
              cursor:
                rows.length > query.limit && last !== undefined
                  ? mintCursor(THREAD_LIST, [last.life, last.movedAt.getTime(), last.threadId])
                  : null,
              rows: page.map((row): ThreadDirectoryRow => {
                const current =
                  row.runId === null ||
                  row.runStatus === null ||
                  row.startedAt === null ||
                  row.heartbeatAt === null ||
                  row.progress === null
                    ? null
                    : currentRunOf(
                        {
                          id: row.runId,
                          status: row.runStatus,
                          startedAt: row.startedAt,
                          heartbeatAt: row.heartbeatAt,
                          handedOverAt: row.handedOverAt,
                          progress: row.progress,
                        },
                        { updatedAt: row.movedAt, capabilities: row.capabilities },
                        now,
                        LEASE_RHYTHM,
                      );
                const run =
                  current === null || current.life !== 'awaiting'
                    ? current
                    : { ...current, askPrompt: nativeAsk(kinds, row.pendingInteraction, current.runId)?.text ?? null };
                return {
                  threadId: row.threadId,
                  projectId: row.projectId,
                  agentId: row.agentId,
                  typeId: agentTypeId(row.agentId, row.profileId, row.hostedAgent),
                  name: row.name,
                  spawnRootId: row.spawnRootId,
                  parentThreadId: row.parentThreadId,
                  spawnedByRunId: row.spawnedByRunId,
                  movedAt: row.movedAt,
                  selection:
                    row.model === null || row.provider === null
                      ? null
                      : { provider: row.provider, model: row.model, reasoning: row.reasoning, account: row.account },
                  provider: row.provider,
                  capabilities: row.capabilities,
                  contextReading: parseThreadContextReading(kinds, row.contextReading),
                  assignment: row.runStatus,
                  failureReason: row.failureReason,
                  failure: parseThreadRunFailure(row.failure),
                  run,
                };
              }),
            };
          }),
        ),
      );
    },
  });
});
