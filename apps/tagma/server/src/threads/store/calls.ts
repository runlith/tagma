import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { AgentThreadRef, PendingRuntimeGuide } from '@runlith/agent/contracts';
import { threadRecord } from '../../thread-record/store/table.js';

export const threadCall = sqliteTable(
  'thread_call',
  {
    actor: text('actor').notNull(),
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    digest: text('digest').notNull(),
    result: text('result', { mode: 'json' }).$type<unknown>().notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.actor, table.operation, table.key] }), index('thread_call_thread_idx').on(table.threadId)],
);

export const owedCall = sqliteTable(
  'owed_call',
  {
    runId: text('run_id').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    input: text('input', { mode: 'json' }).$type<unknown>().notNull(),
    epoch: text('epoch').notNull(),
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    outcome: text('outcome', { enum: ['completed', 'failed', 'stopped', 'interrupted'] }),
    words: text('words'),
    threads: text('threads', { mode: 'json' }).$type<readonly AgentThreadRef[]>(),
    guides: text('guides', { mode: 'json' }).$type<readonly PendingRuntimeGuide[]>(),
    unstarted: integer('unstarted', { mode: 'boolean' }),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.toolCallId] }),
    index('owed_call_thread_idx').on(table.threadId),
    index('owed_call_opened_idx').on(table.openedAt, table.runId, table.toolCallId),
  ],
);

export const spentCallKey = sqliteTable(
  'spent_call_key',
  {
    actor: text('actor').notNull(),
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    digest: text('digest').notNull(),
    spentAt: integer('spent_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.actor, table.operation, table.key] })],
);

export const spentEpoch = sqliteTable(
  'spent_epoch',
  {
    id: integer('id').primaryKey(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [check('spent_epoch_single', sql`${table.id} = 1`)],
);
