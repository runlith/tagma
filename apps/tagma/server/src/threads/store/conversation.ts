import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { threadRecord } from '../../thread-record/store/table.js';
import type { ConversationRole } from '../contract/wire/conversation.js';
import { projectRows } from '../../platform/contract/service/projections.js';

export const threadMessage = sqliteTable(
  'thread_message',
  {
    key: integer('key').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    entryId: text('entry_id').notNull(),
    position: integer('position').notNull(),
    appeared: integer('appeared').notNull(),
    runId: text('run_id'),
    role: text('role').$type<ConversationRole>().notNull(),
    occurredAt: integer('occurred_at').notNull(),
    rewound: text('rewound'),
    text: text('text').notNull(),
  },
  (table) => [
    uniqueIndex('thread_message_entry_unique').on(table.threadId, table.entryId),
    index('thread_message_position_idx').on(table.threadId, table.position),
    index('thread_message_appeared_idx').on(table.threadId, table.appeared),
  ],
);

export const threadConversation = sqliteTable('thread_conversation', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  through: integer('through').notNull().default(0),
  seen: integer('seen').notNull().default(0),
  unreadable: integer('unreadable', { mode: 'boolean' }).notNull().default(false),
});

export const threadMessageGap = sqliteTable(
  'thread_message_gap',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    entryId: text('entry_id').notNull(),
    runId: text('run_id'),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.entryId] })],
);

export const threadQuietRun = sqliteTable(
  'thread_quiet_run',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.runId] })],
);

export const messageRows = projectRows({
  id: 'threads.message',
  table: threadMessage,
  keys: ['key'],
  address: 'threadId',
  columns: { key: threadMessage.key, threadId: threadMessage.threadId, appeared: threadMessage.appeared, rewound: threadMessage.rewound },
});

export const MESSAGE_FTS = 'thread_message_fts';
