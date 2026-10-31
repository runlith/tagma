import type { ThreadFailureDiagnostics } from '@runlith/agent/transcript/entries';
import type {
  ThreadCompactionCheckpointRow,
  ThreadContextReading,
  ThreadHistory,
  ThreadPendingInteraction,
  ThreadRunProgress,
  ThreadRunRow,
  ThreadRunStatus,
} from '@runlith/agent/thread/rows';
import type { ThreadProfileBirth } from '@runlith/agent/thread/agents/AgentProfile';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import type { ThreadTranscript, ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { Usage } from '@runlith/llm/schema/events';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import type { ProvedRoot } from '../../workspace/contract/wire/place.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { thread, threadEntry, threadRun } from '../../threads/store/kernel.js';

export const threadRev = sqliteTable('native_thread_rev', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => thread.id, { onDelete: 'cascade' }),
  foldRev: integer('fold_rev').notNull().default(0),
  inheritRev: integer('inherit_rev').notNull().default(0),
  changeRev: integer('change_rev').notNull().default(0),
  changeOpen: integer('change_open').notNull().default(0),
});

export const threadLog = sqliteTable('thread_log', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  historyThrough: integer('history_through').notNull().default(0),
  entriesThrough: integer('entries_through').notNull().default(0),
  strippedThrough: integer('stripped_through').notNull().default(0),
  boundedThrough: integer('bounded_through'),
  footprintsThrough: integer('footprints_through').notNull().default(0),
});

export const threadHistoryItem = sqliteTable(
  'thread_history_item',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull(),
    message: text('message', { mode: 'json' }).$type<ThreadHistory[number]>().notNull(),
    digest: text('digest'),
    tokens: integer('tokens'),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.ord] })],
);

export function typeOf(entry: ThreadTranscriptEntry): string {
  return entry.type;
}

export function runIdOf(entry: ThreadTranscriptEntry): string | null {
  const runId = entry.runId;
  return typeof runId === 'string' ? runId : null;
}

export const threadRunReceipt = sqliteTable('thread_run_receipt', {
  runId: text('run_id')
    .primaryKey()
    .references(() => threadRun.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  requestDigest: text('request_digest').notNull(),
  result: text('result', { mode: 'json' }).$type<unknown>().notNull(),
});

export const threadCompactionCheckpoint = sqliteTable(
  'thread_compaction_checkpoint',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    sourceRunId: text('source_run_id'),
    coveredMessageCount: integer('covered_message_count').notNull(),
    coveredPrefixHash: text('covered_prefix_hash').notNull(),
    summary: text('summary').notNull(),
    usage: text('usage', { mode: 'json' }).$type<Usage>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('thread_compaction_checkpoint_hash_unique').on(table.threadId, table.coveredPrefixHash),
    index('thread_compaction_checkpoint_latest_idx').on(table.threadId, table.createdAt),
  ],
);

export const threadPrunedToolCall = sqliteTable(
  'thread_pruned_tool_call',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    toolCallId: text('tool_call_id').notNull(),
    tokens: integer('tokens').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.toolCallId] })],
);

export const threadCacheObservation = sqliteTable(
  'thread_cache_observation',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
    stepNumber: integer('step_number').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    sentAt: text('sent_at').notNull(),
    gapMs: integer('gap_ms').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
  },
  (table) => [
    index('thread_cache_observation_thread_idx').on(table.threadId),
    index('thread_cache_observation_provider_gap').on(table.provider, table.gapMs, table.id),
  ],
);

export const targetSnapshot = sqliteTable(
  'target_snapshot',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => threadRun.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    sourceKey: text('source_key').notNull(),
    projectId: integer('project_id').notNull(),
    workingRoot: text('working_root').notNull(),
    graphRoot: text('graph_root').notNull(),
    place: text('place', { mode: 'json' }).$type<ProvedRoot | null>(),
    admittedAt: text('admitted_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.runId, table.generation] }),
    index('target_snapshot_thread_idx').on(table.threadId, table.runId),
    index('target_snapshot_run_idx').on(table.runId),
  ],
);

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type ThreadCompactionCheckpointRowMatches = Assert<Exact<typeof threadCompactionCheckpoint.$inferSelect, ThreadCompactionCheckpointRow>>;
