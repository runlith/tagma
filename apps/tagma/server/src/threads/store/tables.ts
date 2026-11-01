import type { ThreadResourceRow } from '@runlith/agent/thread/storage/resources';
import type {
  ThreadInboxBody,
  ThreadInboxKind,
  ThreadInboxRow,
  ThreadInboxSender,
  ThreadInboxState,
} from '@runlith/agent/thread/storage/inbox';
import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
import { type SQL, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { threadRecord } from '../../thread-record/store/table.js';
import { projectRows } from '../../platform/contract/service/projections.js';
import { OWN_ENDINGS } from '../contract/service/ownWork.js';

export const threadResource = sqliteTable(
  'thread_resource',
  {
    kind: text('kind').notNull(),
    id: text('id').notNull(),
    threadId: text('thread_id').references(() => threadRecord.id, { onDelete: 'set null' }),
    heldAt: integer('held_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.kind, table.id] }), index('thread_resource_thread').on(table.threadId)],
);

export const threadTargetOperation = sqliteTable(
  'thread_target_operation',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    operationKey: text('operation_key').notNull(),
    projectId: integer('project_id').notNull(),
    homeId: integer('home_id'),
    payloadDigest: text('payload_digest').notNull(),
    rootId: text('root_id').notNull(),
    locationRevision: integer('location_revision').notNull(),
    expectedSelectionRevision: integer('expected_selection_revision'),
    selectionRevision: integer('selection_revision').notNull(),
    expectedGeneration: integer('expected_generation'),
    fromGeneration: integer('from_generation'),
    creationOperationId: text('creation_operation_id'),
    runId: text('run_id'),
    status: text('status', { enum: ['pending', 'selected', 'failed', 'applied'] }).notNull(),
    generation: integer('generation'),
    detail: text('detail'),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.operationKey] }),
    index('thread_target_operation_thread_idx').on(table.threadId),
  ],
);

export const threadInbox = sqliteTable(
  'thread_inbox',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    sender: text('sender', { mode: 'json' }).$type<ThreadInboxSender>().notNull(),
    kind: text('kind').$type<ThreadInboxKind>().notNull(),
    body: text('body', { mode: 'json' }).$type<ThreadInboxBody>().notNull(),
    owes: integer('owes', { mode: 'boolean' }).generatedAlwaysAs(
      sql`kind = 'signal' and state = 'queued' and delivered_to_run_id is null
      and json_extract(body, '$.type') in (${sql.join(
        [...OWN_ENDINGS].map((type) => sql`${type}`),
        sql`, `,
      )})
      and json_extract(body, '$.waits') is null`,
      { mode: 'virtual' },
    ),
    state: text('state').$type<ThreadInboxState>().notNull().default('queued'),
    deliveredToRunId: text('delivered_to_run_id'),
    claimId: text('claim_id'),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
    closedBy: text('closed_by'),
    requestDigest: text('request_digest'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    seq: integer('seq').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('thread_inbox_thread_idx').on(table.threadId, table.state, table.occurredAt, table.seq),
    index('thread_inbox_seq_idx').on(table.seq),
    index('thread_inbox_run_idx').on(table.deliveredToRunId, table.state),
    index('thread_inbox_open_request_idx').on(table.threadId, table.kind, table.closedAt, table.occurredAt, table.seq),
  ],
);

export const threadInboxWake = sqliteTable(
  'thread_inbox_wake',
  {
    itemId: text('item_id')
      .primaryKey()
      .references(() => threadInbox.id, { onDelete: 'cascade' }),
    at: integer('at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('thread_inbox_wake_at_idx').on(table.at)],
);

export const threadSeen = sqliteTable('thread_seen', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull(),
});

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type ThreadResourceRowMatches = Assert<Exact<typeof threadResource.$inferSelect, ThreadResourceRow>>;
type ThreadInboxRowMatches = Assert<
  Exact<Omit<typeof threadInbox.$inferSelect, 'claimId' | 'requestDigest' | 'seq' | 'owes'>, ThreadInboxRow>
>;

export const inboxRows = projectRows({
  id: 'threads.inbox',
  table: threadInbox,
  keys: ['id'],
  address: 'threadId',
  columns: {
    id: threadInbox.id,
    threadId: threadInbox.threadId,
    owes: threadInbox.owes,
    deliveredToRunId: threadInbox.deliveredToRunId,
    occurredAt: threadInbox.occurredAt,
  },
});

export const seenRows = projectRows({
  id: 'threads.seen',
  table: threadSeen,
  keys: ['threadId'],
  address: 'threadId',
  columns: { threadId: threadSeen.threadId, runId: threadSeen.runId },
});

export const KEEP_WARM_PING_IDS = `${KEEP_WARM_SIGNAL_TYPE}:%`;

export const keepWarmRun = (runId: SQLiteColumn | SQL): SQL => sql`exists (
  select 1 from ${threadInbox} ki where ki.delivered_to_run_id = ${runId} and ki.id like ${KEEP_WARM_PING_IDS}
)`;
