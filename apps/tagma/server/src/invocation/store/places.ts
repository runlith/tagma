import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { threadRecord } from '../../thread-record/store/table.js';

export const callPlace = sqliteTable(
  'invocation_call_place',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    projectId: integer('project_id').notNull(),
    checkout: text('checkout'),
    branch: text('branch'),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.operation, table.key] })],
);
