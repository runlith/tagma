import type { ThreadFailureDiagnostics } from '@runlith/agent/transcript/entries';
import type {
  ThreadContextReading,
  ThreadHistory,
  ThreadPendingInteraction,
  ThreadRunCost,
  ThreadRunKind,
  ThreadRunOrigin,
  ThreadRunProgress,
  ThreadRunRow,
  ThreadRunStatus,
} from '@runlith/agent/thread/rows';
import type { ThreadDefinition, ThreadProfileBirth } from '@runlith/agent/thread/agents/AgentProfile';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import type { ThreadTranscript, ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { Usage } from '@runlith/llm/schema/events';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '@runlith/agent/thread/storage/runs';
import { STALL_FLOOR_MS } from '@runlith/agent/callProgress';
import { type SQL, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import { threadRecord } from '../../thread-record/store/table.js';
import { recordFacts } from '../../thread-record/facts.js';
import { entryField } from './fields.js';
import { RUN_ENDINGS } from '@runlith/agent/transcript/live';
import type { TransportBinding } from '@runlith/agent/thread/record';
import type { TransportCapabilities } from '@runlith/agent/thread/record';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';

export const ENDINGS_LIST: SQL = sql.raw(`(${RUN_ENDINGS.map((status) => `'${status}'`).join(', ')})`);

export const THREAD_OPEN_QUESTION_INDEX = 'native_thread_open_question_idx';

export const thread = sqliteTable(
  'native_thread',
  {
    id: text('id')
      .primaryKey()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    cacheGroup: text('cache_group').notNull(),
    profile: text('profile', { mode: 'json' }).$type<ThreadProfileBirth | null>(),
    pendingInteraction: text('pending_interaction', { mode: 'json' }).$type<ThreadPendingInteraction>(),
    account: text('account'),
    provider: text('provider').notNull(),
    model: text('model'),
    reasoning: text('reasoning'),
    switches: text('switches', { mode: 'json' }).$type<ModelSwitches>().notNull().default({}),
    transport: text('transport', { mode: 'json' }).$type<TransportBinding>().notNull().default(NATIVE_BINDING),
    capabilities: text('capabilities', { mode: 'json' }).$type<TransportCapabilities>().notNull().default(NATIVE_CAPABILITIES),
    callEnvelopeMs: integer('call_envelope_ms').generatedAlwaysAs(sql`json_extract(capabilities, '$.callEnvelopeMs')`, { mode: 'virtual' }),
    systemPrompt: text('system_prompt'),
    pendingSystemPrompt: text('pending_system_prompt'),
    pendingDefinition: text('pending_definition', { mode: 'json' }).$type<ThreadDefinition>(),
    failureReason: text('failure_reason'),
    contextReading: text('context_reading', { mode: 'json' }).$type<ThreadContextReading>(),
    contextEventId: integer('context_event_id').notNull().default(0),
    worldStateSnapshot: text('world_state_snapshot', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
    worldStateCheckpointId: text('world_state_checkpoint_id'),
    contextRuns: text('context_runs', { mode: 'json' }).$type<readonly string[]>(),
    forkOf: text('fork_of'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('native_thread_updated_idx').on(table.updatedAt),
    index('native_thread_asking_idx')
      .on(table.id)
      .where(sql`${entryField(table.pendingInteraction, 'action')} is not null`),
    index(THREAD_OPEN_QUESTION_INDEX)
      .on(table.id)
      .where(sql`${entryField(table.pendingInteraction, 'status')} = 'open'`),
  ],
);

export const ENTRY_OPEN_QUESTION_INDEX = 'thread_entry_open_question_idx';
export const THREAD_ENTRY_TOOL_LENGTH_INDEX = 'thread_entry_tool_length_idx';

export const threadEntry = sqliteTable(
  'thread_entry',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull(),
    entryId: text('entry_id').notNull(),
    runId: text('run_id'),
    type: text('type').notNull(),
    entry: text('entry', { mode: 'json' }).$type<ThreadTranscriptEntry>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.ord] }),
    uniqueIndex('thread_entry_id_unique').on(table.threadId, table.entryId),
    index('thread_entry_run_idx').on(table.threadId, table.runId, table.ord),
    index('thread_entry_type_idx').on(table.type, table.threadId),
    index(ENTRY_OPEN_QUESTION_INDEX)
      .on(table.threadId)
      .where(sql`${table.type} = 'question' and ${entryField(table.entry, 'status')} = 'open'`),
    index(THREAD_ENTRY_TOOL_LENGTH_INDEX)
      .on(sql`length(${table.entry})`)
      .where(sql`${table.type} = 'tool'`),
  ],
);

export const threadRun = sqliteTable(
  'thread_run',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ThreadRunKind>().notNull().default('turn'),
    origin: text('origin').$type<ThreadRunOrigin>().notNull().default('core'),
    status: text('status').$type<ThreadRunStatus>().notNull().default('running'),
    ownerId: text('owner_id').notNull(),
    account: text('account'),
    provider: text('provider'),
    model: text('model'),
    reasoning: text('reasoning'),
    switches: text('switches', { mode: 'json' }).$type<ModelSwitches>().notNull().default({}),
    approvalMode: text('approval_mode').$type<AgentApprovalMode>().notNull().default('trust'),
    interactive: integer('interactive', { mode: 'boolean' }).notNull().default(false),
    progress: text('progress', { mode: 'json' }).$type<ThreadRunProgress>().notNull().default({ stage: null, message: null }),
    usage: text('usage', { mode: 'json' }).$type<Usage>(),
    cost: text('cost', { mode: 'json' }).$type<ThreadRunCost>(),
    streamTail: text('stream_tail', { mode: 'json' }).$type<ThreadTranscript>(),
    resumes: integer('resumes').notNull().default(0),
    failureReason: text('failure_reason'),
    failure: text('failure', { mode: 'json' }).$type<ThreadFailureDiagnostics>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    startedAt: integer('started_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    heartbeatAt: integer('heartbeat_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    handedOverAt: integer('handed_over_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    settledNotifiedAt: integer('settled_notified_at', { mode: 'timestamp_ms' }),
    settledBy: text('settled_by').$type<ThreadRunRow['settledBy']>(),
    settledNotification: text('settled_notification', { mode: 'json' }).$type<ThreadRunRow['settledNotification']>(),
    settledNotifyAttempts: integer('settled_notify_attempts').notNull().default(0),
    stopRequest: text('stop_request', { mode: 'json' }).$type<ThreadRunRow['stopRequest']>(),
    withdrawnWords: text('withdrawn_words', { mode: 'json' }).$type<ThreadRunRow['withdrawnWords']>(),
    appliedSeq: integer('applied_seq').notNull().default(0),
    startKey: text('start_key'),
    startDigest: text('start_digest'),
    endDigest: text('end_digest'),
    endResult: text('end_result', { mode: 'json' }).$type<unknown>(),
    saidLive: text('said_live'),
    saidFinal: text('said_final'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('thread_run_thread_idx').on(table.threadId, table.createdAt),
    index('thread_run_terminal_idx')
      .on(table.threadId, table.id)
      .where(sql`${table.status} in ${ENDINGS_LIST}`),
    index('thread_run_ended_idx')
      .on(table.threadId, table.finishedAt, table.id)
      .where(sql`${table.status} in ${ENDINGS_LIST}`),
    index('thread_run_heartbeat_idx').on(table.status, table.heartbeatAt),
    uniqueIndex('thread_run_active_unique')
      .on(table.threadId)
      .where(sql`${table.status} = 'running'`),
    uniqueIndex('thread_run_start_key_unique')
      .on(table.threadId, table.startKey)
      .where(sql`${table.startKey} is not null`),
  ],
);

export const threadRunTally = sqliteTable(
  'thread_run_tally',
  {
    threadId: text('thread_id')
      .primaryKey()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    endedRuns: integer('ended_runs').notNull().default(0),
    latestRunId: text('latest_run_id').notNull(),
    latestFinishedAt: integer('latest_finished_at', { mode: 'timestamp_ms' }).notNull(),
    unseen: integer('unseen', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [
    index('thread_run_tally_unseen_idx')
      .on(table.threadId)
      .where(sql`${table.unseen} = 1`),
  ],
);

export const ENDED_RUN: SQL = sql`${threadRun.status} in ${ENDINGS_LIST}`;

export const unparkedRun: SQL = sql`(${threadRun.status} = 'running'
  and json_extract(${threadRun.progress}, '$.stage') is not ${THREAD_RUN_AWAITING_QUESTION_STAGE})`;

export const stalledKernelThread = (now: Date): SQL =>
  sql`(${thread.updatedAt} + max(${thread.callEnvelopeMs}, ${STALL_FLOOR_MS}) < ${now.getTime()})`;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type ThreadRunRecordColumns = 'appliedSeq' | 'startKey' | 'startDigest' | 'endDigest' | 'endResult' | 'saidLive' | 'saidFinal';
type ThreadRunRowMatches = Assert<Exact<Omit<typeof threadRun.$inferSelect, ThreadRunRecordColumns>, ThreadRunRow>>;
