import { type AnySQLiteColumn, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import { project } from '../../projects/store/table.js';

export const threadFolder = sqliteTable(
  'thread_folder',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => threadFolder.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('thread_folder_project_idx').on(table.projectId, table.parentId, table.position)],
);
