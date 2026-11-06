import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, not, or, sql, type SQL } from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { ENDED_RUN, thread, threadRun, stalledKernelThread, unparkedRun } from '../store/kernel.js';
import { threadSeen, keepWarmRun } from '../store/tables.js';
import { entryField } from '../store/fields.js';
import { threadLiveSpell, threadMandate } from '../store/mandate.js';
import type { PluginHiding } from '../contract/service/listing.js';
import { liveRootOf, subtreeOf } from '../../thread-record/lineage.js';
import { recordFacts, recordsAs } from '../../thread-record/facts.js';
import { mandateFacts } from '../mandate.js';
import { liveProcesses, sessionOf, sessionRows } from '../store/harnessFacet.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { readableField } from '../../platform/store/readableJson.js';
import type { ThreadSummary } from './summary.js';
import { recapStatusOf } from '../recap/standing.js';

export type ThreadListView = 'live' | 'archived' | 'all';

export type ThreadRunMatch = {
  readonly models?: readonly string[];
  readonly providers?: readonly string[];
  readonly statuses?: readonly ThreadRunRow['status'][];
  readonly since?: Date;
  readonly before?: Date;
};

export type ThreadReachTerm = 'children' | 'descendants' | 'tree';

export type ThreadClockRange = {
  readonly since?: Date;
  readonly before?: Date;
};

export type ThreadStateTerm = { readonly kind: 'running' } | { readonly kind: 'stalled'; readonly now: Date };

export type ThreadSelection = {
  readonly view: ThreadListView;
  readonly state?: ThreadStateTerm;
  readonly ids?: readonly string[];
  readonly plugin?: string;
  readonly title?: string;
  readonly of?: { readonly thread: string; readonly reach: ThreadReachTerm };
  readonly ran?: ThreadRunMatch;
  readonly active?: ThreadClockRange;
  readonly createdAt?: ThreadClockRange;
  readonly updatedAt?: ThreadClockRange;
  readonly readerOrderAt?: ThreadClockRange;
  readonly archivedAt?: ThreadClockRange;
  readonly limit?: number;
  readonly before?: ThreadCursor;
};

export type ThreadCursor = { readonly orderAt: Date; readonly id: string };

export type ThreadPage = {
  readonly rows: readonly ThreadSummary[];
  readonly total: number;
  readonly before: ThreadCursor | null;
};

export type ListHomes = { readonly id: number; readonly projects: readonly number[] };

export type ThreadFamily = { readonly listId: number; readonly rows: readonly ThreadSummary[] };

export type ThreadWindow = {
  readonly rows: readonly ThreadSummary[];
  readonly roots: number;
  readonly windowBefore: Date | null;
};

export type ThreadWindowIds = Omit<ThreadWindow, 'rows'> & { readonly ids: readonly string[] };

const homesSql = (homes: readonly number[]): SQL =>
  sql`(${sql.join(
    homes.map((home) => sql`${home}`),
    sql`, `,
  )})`;

const unasked: SQL = sql`${readableField(recordFacts.bornOf, '$.ask')} is null`;

const boundPlugin: SQL = sql`json_extract(${threadMandate.bindings}, '$.plugin')`;

export const unhidden = (hiding: PluginHiding, id: SQL | SQLiteColumn, project: SQL | SQLiteColumn): SQL | undefined => {
  if (hiding.size === 0) return undefined;
  const hides = [...hiding].map(
    ([home, plugins]) =>
      sql`(${project} = ${home} and ${boundPlugin} in (${sql.join(
        [...plugins].map((plugin) => sql`${plugin}`),
        sql`, `,
      )}))`,
  );
  return sql`not exists (select 1 from ${threadMandate} where ${threadMandate.id} = ${id} and (${sql.join(hides, sql` or `)}))`;
};

const generalList = (selection: ThreadSelection, hiding: PluginHiding): SQL | undefined => {
  if (selection.plugin !== undefined) {
    return sql`exists (select 1 from ${threadMandate} where ${threadMandate.id} = ${recordFacts.id} and ${boundPlugin} = ${selection.plugin})`;
  }
  return selection.ids === undefined ? unhidden(hiding, recordFacts.id, recordFacts.projectId) : undefined;
};

export const selected = (ownerId: string, homes: readonly number[], selection: ThreadSelection, hiding: PluginHiding): SQL | undefined =>
  and(
    eq(recordFacts.principalId, ownerId),
    inArray(recordFacts.projectId, [...homes]),
    unasked,
    generalList(selection, hiding),
    archivedView(selection.view),
    stateOf(selection.state),
    selection.ids === undefined ? undefined : inArray(recordFacts.id, [...selection.ids]),
    namedBy(selection.title),
    reachOf(selection.of),
    ranBy(selection.ran),
    clockRange(recordFacts.createdAt, selection.createdAt),
    clockRange(sql`coalesce(${thread.updatedAt}, ${recordFacts.movedAt})`, selection.updatedAt),
    clockRange(recordFacts.readerOrderAt, selection.readerOrderAt),
    clockRange(recordFacts.archivedAt, selection.archivedAt),
  );

export type ThreadSelectionPage = {
  readonly ids: readonly string[];
  readonly total: number;
  readonly reading: string;
};

const ASKING = sql.raw('n.pending_interaction');

export const outcomeRunOf = (threadId: SQLiteColumn | SQL): SQL<string | null> => sql<string | null>`(
  select ${threadRun.id}
  from ${threadRun}
  where ${and(eq(threadRun.threadId, threadId), ENDED_RUN, not(keepWarmRun(threadRun.id)))}
  order by ${threadRun.id} desc
  limit 1
)`;

export const pastCursor = (clock: SQLiteColumn, before: ThreadCursor | undefined): SQL | undefined =>
  before === undefined
    ? undefined
    : sql`(${clock} < ${before.orderAt.getTime()} or (${clock} = ${before.orderAt.getTime()} and ${recordFacts.id} < ${before.id}))`;

export const archivedView = (view: ThreadListView): SQL | undefined =>
  view === 'all' ? undefined : view === 'live' ? isNull(recordFacts.archivedAt) : isNotNull(recordFacts.archivedAt);

export const reachOf = (of: ThreadSelection['of']): SQL | undefined => {
  if (of === undefined) return undefined;
  if (of.reach === 'children') return eq(recordFacts.parentId, of.thread);
  if (of.reach === 'descendants') {
    return and(sql`${recordFacts.id} in ${subtreeOf(of.thread)}`, sql`${recordFacts.id} != ${of.thread}`);
  }
  return sql`${recordFacts.spawnRootId} = (select spawn_root_id from ${recordsAs('reach')} where id = ${of.thread})`;
};

export const namedBy = (term: string | undefined): SQL | undefined => {
  if (term === undefined) return undefined;
  const part = `%${term}%`;
  return or(like(recordFacts.title, part), like(recordFacts.name, part));
};

export const ranBy = (ran: ThreadRunMatch | undefined): SQL | undefined => {
  if (ran === undefined) return undefined;
  const terms: (SQL | undefined)[] = [
    ran.models === undefined ? undefined : inArray(threadRun.model, [...ran.models]),
    ran.providers === undefined ? undefined : inArray(threadRun.provider, [...ran.providers]),
    ran.statuses === undefined ? undefined : inArray(threadRun.status, [...ran.statuses]),
    ran.before === undefined ? undefined : sql`${threadRun.startedAt} < ${ran.before.getTime()}`,
    ran.since === undefined ? undefined : sql`coalesce(${threadRun.finishedAt}, ${threadRun.heartbeatAt}) >= ${ran.since.getTime()}`,
  ];
  return sql`exists (
    select 1 from ${threadRun}
     where ${and(eq(threadRun.threadId, recordFacts.id), ...terms)}
  )`;
};

export const clockRange = (column: SQL | SQLiteColumn, range: ThreadClockRange | undefined): SQL | undefined => {
  if (range === undefined) return undefined;
  const parts: SQL[] = [];
  if (range.since !== undefined) parts.push(sql`${column} >= ${range.since.getTime()}`);
  if (range.before !== undefined) parts.push(sql`${column} < ${range.before.getTime()}`);
  return parts.length === 0 ? undefined : and(...parts);
};

const runningRuns: SQL = sql`
  select ${threadRun.id} as id, ${threadRun.threadId} as thread_id, 'run' as kind, ${NATIVE_HARNESS} as harness
    from ${threadRun} where status = 'running'`;

export const activeSessions: SQL = sql`(${runningRuns})`;

export const heldSessions: SQL = sql`(${runningRuns} union all ${liveProcesses(
  sql`not exists (select 1 from ${threadRun} where ${threadRun.threadId} = ${sessionRows.id} and ${threadRun.status} = 'running')`,
)})`;

export const pulseDriven: SQL = sql`${recordFacts.id} in (
  select r.thread_id from ${threadRun} r where r.status = 'running'
  union
  select n.id from ${thread} n where ${entryField(ASKING, 'action')} is not null
)`;

export const stateOf = (state: ThreadStateTerm | undefined): SQL | undefined => {
  if (state === undefined) return undefined;
  if (state.kind === 'running') return sql`${recordFacts.id} in (select thread_id from ${activeSessions})`;
  return sql`${recordFacts.id} in (
    select ${threadRun.threadId} from ${threadRun} join ${thread} on ${thread.id} = ${threadRun.threadId}
    where ${unparkedRun} and ${stalledKernelThread(state.now)}
  )`;
};

export const heldUp: SQL = sql`(
  with recursive held(id, run_id, kind, session_thread, harness) as (
    select thread_id, id, kind, thread_id, harness from ${heldSessions}
    union
    select up.parent_id, h.run_id, h.kind, h.session_thread, h.harness from ${recordsAs('up')} join held h on h.id = up.id
    where up.parent_id is not null
  )
  select id, run_id, kind, session_thread, harness from held
)`;

export const liveRoot = (ownerId: string, homes: readonly number[]): SQL => sql`(
  ${recordFacts.parentId} is null
  or not exists (
    select 1 from ${recordsAs('parent')}
     where parent.id = ${recordFacts.parentId}
       and parent.principal_id = ${ownerId}
       and parent.project_id in ${homesSql(homes)}
       and parent.archived_at is null
  )
)`;

export const liveFamilyOf = (ownerId: string, seeds: readonly string[], hiding: PluginHiding): SQL => sql`(
  with recursive family(id) as (
    select value from json_each(${JSON.stringify(seeds)})
    union
    select child.id from family f
      cross join ${recordsAs('child')} on child.parent_id = f.id
      where child.principal_id = ${ownerId}
        and child.archived_at is null
        and ${readableField(sql.raw('child.born_of'), '$.ask')} is null
        and ${unhidden(hiding, sql.raw('child.id'), sql.raw('child.project_id')) ?? sql`true`}
  )
  select id from family
)`;

const rootsAbove = (ownerId: string, homes: readonly number[], seeds: SQL, seeded: SQL): SQL => sql`(
  with recursive climb(id, parent) as (
    select seed.id, seed.parent_id from ${seeds}
      where ${seeded} and seed.principal_id = ${ownerId} and seed.archived_at is null
        and exists (
          select 1 from ${recordsAs('local')}
          where local.spawn_root_id = seed.spawn_root_id and local.project_id in ${homesSql(homes)}
            and local.principal_id = ${ownerId} and local.archived_at is null
        )
    union
    select ancestor.id, ancestor.parent_id from climb c
      cross join ${recordsAs('ancestor')} on ancestor.id = c.parent
      where ancestor.principal_id = ${ownerId} and ancestor.archived_at is null
  )
  select id from climb
)`;

export const runningRoots = (ownerId: string, homes: readonly number[]): SQL =>
  rootsAbove(ownerId, homes, sql`${threadRun} r cross join ${recordsAs('seed')} on seed.id = r.thread_id`, sql`r.status = 'running'`);

export const rootsOf = (ownerId: string, homes: readonly number[], ids: readonly string[]): SQL =>
  rootsAbove(ownerId, homes, sql`${recordsAs('seed')}`, sql`seed.id in (select value from json_each(${JSON.stringify(ids)}))`);

export const pinnedRoots = (ownerId: string, homes: readonly number[]): SQL =>
  rootsAbove(ownerId, homes, sql`${recordsAs('seed')}`, sql`seed.pinned_at is not null and seed.parent_id is not null`);

export function summariesOf(db: StoreDb<'machine'>, where: SQL | undefined) {
  const terminalRun = alias(threadRun, 'terminal_run');
  const liveSpell = alias(threadLiveSpell, 'live_spell');
  const latestTerminalRunId = outcomeRunOf(recordFacts.id);
  const facet = sessionOf(recordFacts.id);
  const said = sql<string | null>`case
    when ${threadRun.id} is not null then ${threadRun.saidLive}
    when ${terminalRun.status} = 'completed' then ${terminalRun.saidFinal}
  end`;
  return db
    .select({
      thread: {
        id: recordFacts.id,
        ownerId: recordFacts.principalId,
        agentId: recordFacts.agentId,
        parentThreadId: recordFacts.parentId,
        spawnedByRunId: recordFacts.spawnedByRunId,
        bornOf: recordFacts.bornOf,
        spawnRootId: recordFacts.spawnRootId,
        cacheGroup: thread.cacheGroup,
        name: recordFacts.name,
        budgetTokens: mandateFacts.budgetTokens,
        profile: thread.profile,
        authority: mandateFacts.authority,
        plain: mandateFacts.plain,
        hostKind: mandateFacts.hostKind,
        hostId: mandateFacts.hostId,
        bindings: mandateFacts.bindings,
        pendingInteraction: thread.pendingInteraction,
        account: thread.account,
        provider: thread.provider,
        model: thread.model,
        reasoning: thread.reasoning,
        switches: thread.switches,
        transport: thread.transport,
        capabilities: thread.capabilities,
        status: recordFacts.status,
        failureReason: thread.failureReason,
        contextReading: thread.contextReading,
        createdBy: recordFacts.createdBy,
        createdAt: recordFacts.createdAt,
        updatedAt: sql<number>`coalesce(${thread.updatedAt}, ${recordFacts.movedAt}, ${recordFacts.createdAt})`.mapWith(
          (value) => new Date(value),
        ),
      },
      title: recordFacts.title,
      titleOrigin: recordFacts.titleOrigin,
      createdBySessionId: recordFacts.createdBySessionId,
      harness: facet,
      picked: thread.pendingModel,
      projectId: sql<number>`${recordFacts.projectId}`,
      scopeBlockUuid: recordFacts.scopeBlockUuid,
      readerOrderAt: recordFacts.readerOrderAt,
      liveSpellStartedAt: liveSpell.startedAt,
      pinnedAt: recordFacts.pinnedAt,
      folderId: recordFacts.folderId,
      archivedAt: recordFacts.archivedAt,
      detachedFrom: recordFacts.detachedFrom,
      runId: threadRun.id,
      runStatus: threadRun.status,
      heartbeatAt: threadRun.heartbeatAt,
      handedOverAt: threadRun.handedOverAt,
      runResumes: threadRun.resumes,
      runStartedAt: threadRun.startedAt,
      progress: threadRun.progress,
      runProvider: threadRun.provider,
      runModel: threadRun.model,
      runReasoning: threadRun.reasoning,
      outcomeRunId: terminalRun.id,
      outcomeStatus: terminalRun.status,
      outcomeFailureReason: terminalRun.failureReason,
      outcomeFailure: terminalRun.failure,
      outcomeProvider: terminalRun.provider,
      outcomeModel: terminalRun.model,
      outcomeReasoning: terminalRun.reasoning,
      outcomeFinishedAt: terminalRun.finishedAt,
      seenRunId: threadSeen.runId,
      said,
      recap: recordFacts.recap,
      recapStatus: recapStatusOf(recordFacts.id, recordFacts.recap),
    })
    .from(recordFacts)
    .innerJoin(mandateFacts, eq(mandateFacts.id, recordFacts.id))
    .innerJoin(thread, eq(thread.id, recordFacts.id))
    .leftJoin(liveSpell, sql`${liveSpell.threadId} = ${liveRootOf(recordFacts.id)}`)
    .leftJoin(threadRun, and(eq(threadRun.threadId, recordFacts.id), eq(threadRun.status, 'running')))
    .leftJoin(terminalRun, eq(terminalRun.id, latestTerminalRunId))
    .leftJoin(threadSeen, eq(threadSeen.threadId, recordFacts.id))
    .where(and(isNotNull(recordFacts.projectId), where));
}
