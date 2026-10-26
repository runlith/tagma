import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { threadRecord } from '../../thread-record/store/table.js';

export const threadPlace = sqliteTable(
  'thread_place',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').notNull(),
    root: text('root').notNull(),
    enteredAt: integer('entered_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.projectId] })],
);

export const threadCopy = sqliteTable(
  'thread_copy',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').notNull(),
    root: text('root').notNull(),
    enteredAt: integer('entered_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    pendingAt: integer('pending_at', { mode: 'timestamp_ms' }),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.projectId, table.root] })],
);
