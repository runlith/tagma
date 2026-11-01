import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { Schema } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { nullableColumn, selectRows } from '../../platform/contract/service/projections.js';
import { among } from '../../platform/store/rows.js';
import { recordRows, threadRecord } from '../../thread-record/store/table.js';
import { nativeRows, runRows, thread, threadRun } from '../store/kernel.js';
import { inboxRows, seenRows, threadInbox, threadSeen, KEEP_WARM_PING_IDS } from '../store/tables.js';
import { mandateRows, spellRows, threadLiveSpell, threadMandate } from '../store/mandate.js';
import { externalSession, sessionFacts } from '../store/harnessFacet.js';
import { messageRows, threadMessage } from '../store/conversation.js';
import { publishedSourceRows } from '../store/journal.js';
import { owedCall, owedRows } from '../store/calls.js';
import { commandOwing, commandOwedThreads, deliveryRows } from '../../executions/contract/service/commands.js';
import { assignmentSelection, placementRows } from '../../workspace/store/tables.js';
import { ThreadAncestry } from '../contract/service/rows.js';
import { outcomeRunOf } from './select.js';

const fields = (columns: Readonly<Record<string, SQLiteColumn>>): SQL =>
  sql.join(
    Object.entries(columns).map(([name, column]) => sql`${column} as ${sql.identifier(name)}`),
    sql`, `,
  );

const endingColumns = {
  id: threadRun.id,
  status: threadRun.status,
  failureReason: threadRun.failureReason,
  failure: threadRun.failure,
  provider: threadRun.provider,
  model: threadRun.model,
  reasoning: threadRun.reasoning,
  finishedAt: threadRun.finishedAt,
  saidFinal: threadRun.saidFinal,
};

const PING: (row: SQL) => SQL = (row) => sql`${row}.id like ${KEEP_WARM_PING_IDS}`;

export const outcomeInput = selectRows({
  id: 'threads.outcome',
  columns: endingColumns,
  query: (key) => sql`select ${fields(endingColumns)} from ${threadRun} where ${threadRun.id} = ${outcomeRunOf(key)}`,
  sources: [
    {
      rows: runRows,
      columns: ['id', 'thread_id', 'status', 'failure_reason', 'failure', 'provider', 'model', 'reasoning', 'finished_at', 'said_final'],
    },
    { rows: inboxRows, columns: ['id', 'thread_id', 'delivered_to_run_id'], when: PING },
  ],
});

export const latestInput = selectRows({
  id: 'threads.latest',
  columns: {
    id: threadRun.id,
    status: threadRun.status,
    createdAt: threadRun.createdAt,
    pingId: nullableColumn(threadInbox.id),
    pingAt: nullableColumn(threadInbox.occurredAt),
  },
  query: (key) => sql`select ${threadRun.id} as id, ${threadRun.status} as status, ${threadRun.createdAt} as "createdAt",
    (select ${threadInbox.id} from ${threadInbox} where ${threadInbox.deliveredToRunId} = ${threadRun.id} and ${threadInbox.id} like ${KEEP_WARM_PING_IDS} limit 1) as "pingId",
    (select ${threadInbox.occurredAt} from ${threadInbox} where ${threadInbox.deliveredToRunId} = ${threadRun.id} and ${threadInbox.id} like ${KEEP_WARM_PING_IDS} limit 1) as "pingAt"
    from ${threadRun} where ${threadRun.threadId} = ${key} order by ${threadRun.createdAt} desc, ${threadRun.id} desc limit 1`,
  sources: [
    { rows: runRows, columns: ['id', 'thread_id', 'status', 'created_at'] },
    { rows: inboxRows, columns: ['id', 'thread_id', 'delivered_to_run_id', 'occurred_at'], when: PING },
  ],
});

export const recapInput = selectRows({
  id: 'threads.recap-position',
  columns: { appeared: nullableColumn(threadMessage.appeared) },
  query: (key) => sql`select max(${threadMessage.appeared}) as appeared from ${threadMessage}
    where ${threadMessage.threadId} = ${key} and ${threadMessage.rewound} is null`,
  sources: [
    { rows: messageRows, columns: ['thread_id', 'appeared', 'rewound'] },
    { rows: publishedSourceRows, columns: publishedSourceRows.raw.columns },
  ],
});

export const owingInput = selectRows({
  id: 'threads.owing',
  columns: { owing: threadInbox.owes },
  query: (key) => sql`select (
    exists (select 1 from ${owedCall} where ${owedCall.threadId} = ${key})
    or ${commandOwing(key)}
    or exists (select 1 from ${threadInbox} where ${threadInbox.threadId} = ${key} and ${threadInbox.owes} = 1)
  ) as owing`,
  sources: [
    { rows: owedRows, columns: ['thread_id'] },
    { rows: deliveryRows, columns: ['thread_id'] },
    { rows: inboxRows, columns: ['thread_id', 'owes'], when: (row) => sql`${row}.owes = 1` },
  ],
});

const decodeAncestry = Schema.decodeUnknownSync(Schema.fromJsonString(ThreadAncestry));

const ancestryOf = (key: SQL): SQL => sql`(
  with recursive climb(id, parent, home, principal, archived, depth) as (
    select id, parent_id, project_id, principal_id, archived_at, 0 from ${threadRecord} where id = ${key}
    union all
    select p.id, p.parent_id, p.project_id, p.principal_id, p.archived_at, c.depth + 1 from ${threadRecord} p join climb c on p.id = c.parent
  ) select json_group_array(json_object('id', id, 'parent', parent, 'home', home, 'principal', principal, 'archived', archived,
    'spell', (select ${threadLiveSpell.startedAt} from ${threadLiveSpell} where ${threadLiveSpell.threadId} = climb.id)))
    from (select * from climb order by depth) climb
)`;

export const ancestryInput = selectRows({
  id: 'threads.ancestry',
  columns: { path: { decode: (value) => decodeAncestry(value) } },
  query: (key) => sql`select ${ancestryOf(key)} as path`,
  sources: [
    { rows: recordRows, columns: ['id', 'parent_id', 'project_id', 'principal_id', 'archived_at'] },
    { rows: runRows, columns: ['id', 'thread_id', 'status'] },
    { rows: owedRows, columns: ['thread_id'] },
    { rows: deliveryRows, columns: ['thread_id'] },
    { rows: inboxRows, columns: ['thread_id', 'owes'], when: (row) => sql`${row}.owes = 1` },
  ],
});

const activityColumns = {
  threadId: threadRecord.id,
  projectId: threadRecord.projectId,
  parentId: threadRecord.parentId,
  rootId: assignmentSelection.rootId,
  runId: threadRun.id,
  runStatus: threadRun.status,
  progress: threadRun.progress,
  resumes: threadRun.resumes,
  heartbeatAt: threadRun.heartbeatAt,
  startedAt: threadRun.startedAt,
  handedOverAt: threadRun.handedOverAt,
  runProvider: threadRun.provider,
  runModel: threadRun.model,
  runReasoning: threadRun.reasoning,
  saidLive: threadRun.saidLive,
};

export const activityInput = selectRows({
  id: 'threads.activity',
  columns: {
    ...activityColumns,
    rootId: nullableColumn(assignmentSelection.rootId),
    runId: nullableColumn(threadRun.id),
    runStatus: nullableColumn(threadRun.status),
    progress: nullableColumn(threadRun.progress),
    resumes: nullableColumn(threadRun.resumes),
    heartbeatAt: nullableColumn(threadRun.heartbeatAt),
    startedAt: nullableColumn(threadRun.startedAt),
  },
  query: (key) => sql`select ${fields(activityColumns)} from ${threadRecord}
    left join ${threadRun} on ${threadRun.threadId} = ${threadRecord.id} and ${threadRun.status} = 'running'
    left join ${assignmentSelection} on ${assignmentSelection.threadId} = ${threadRecord.id}
    where ${threadRecord.id} = ${key}`,
  sources: [
    { rows: recordRows, columns: ['id', 'project_id', 'parent_id'] },
    { rows: runRows, columns: ['id', 'thread_id', 'status'] },
    { rows: placementRows, columns: ['thread_id', 'root_id'] },
  ],
});

const NATIVE_PLACED = [
  'cache_group',
  'profile',
  'pending_interaction',
  'account',
  'provider',
  'model',
  'reasoning',
  'switches',
  'transport',
  'capabilities',
  'failure_reason',
  'context_reading',
];

export const placeInput = selectRows({
  id: 'threads.place',
  columns: { home: threadRecord.projectId, parent: threadRecord.parentId, principal: threadRecord.principalId },
  query: (key) => sql`select ${threadRecord.projectId} as home, ${threadRecord.parentId} as parent, ${threadRecord.principalId} as principal
    from ${threadRecord} where ${threadRecord.id} = ${key}`,
  sources: [
    { rows: nativeRows, columns: NATIVE_PLACED },
    { rows: mandateRows, columns: mandateRows.raw.columns },
    { rows: sessionFacts, columns: ['facet'] },
    { rows: seenRows, columns: ['run_id'] },
    { rows: messageRows, columns: ['thread_id', 'appeared', 'rewound'] },
  ],
});

export const threadRowDeclarations = {
  rows: [nativeRows, runRows, inboxRows, seenRows, mandateRows, spellRows, sessionFacts, owedRows, messageRows, publishedSourceRows].map(
    (rows) => rows.raw,
  ),
  selections: [outcomeInput, latestInput, recapInput, owingInput, ancestryInput, activityInput, placeInput].map((input) => input.raw),
};

const projectedSubjects: SQL = sql`(
  select ${threadRun.threadId} as id from ${threadRun} where ${threadRun.status} = 'running'
  union select ${owedCall.threadId} as id from ${owedCall}
  union ${commandOwedThreads}
  union select ${threadInbox.threadId} as id from ${threadInbox} where ${threadInbox.owes} = 1
)`;

export const narrowRows = (db: StoreDb<'machine'>, unit: Unit<'machine'>) =>
  unit.run(
    db
      .select({
        id: threadRecord.id,
        activity: activityInput.encoded(threadRecord.id),
        ancestry: ancestryInput.encoded(threadRecord.id),
        owing: owingInput.encoded(threadRecord.id),
      })
      .from(threadRecord)
      .where(sql`${threadRecord.id} in ${projectedSubjects}`),
  );

export const heldRows = (db: StoreDb<'machine'>, unit: Unit<'machine'>, ids: readonly string[]) =>
  unit.run(
    db
      .select({
        record: recordRows.columns,
        native: nativeRows.columns,
        mandate: mandateRows.columns,
        facet: externalSession.facet,
        seen: threadSeen.runId,
        root: assignmentSelection.rootId,
        activity: activityInput.encoded(threadRecord.id),
        outcome: outcomeInput.encoded(threadRecord.id),
        latest: latestInput.encoded(threadRecord.id),
        recap: recapInput.encoded(threadRecord.id),
        owing: owingInput.encoded(threadRecord.id),
        ancestry: ancestryInput.encoded(threadRecord.id),
      })
      .from(threadRecord)
      .innerJoin(thread, eq(thread.id, threadRecord.id))
      .innerJoin(threadMandate, eq(threadMandate.id, threadRecord.id))
      .leftJoin(externalSession, eq(externalSession.id, threadRecord.id))
      .leftJoin(threadSeen, eq(threadSeen.threadId, threadRecord.id))
      .leftJoin(assignmentSelection, eq(assignmentSelection.threadId, threadRecord.id))
      .where(and(inArray(threadRecord.id, among(ids)), isNotNull(threadRecord.projectId))),
  );
