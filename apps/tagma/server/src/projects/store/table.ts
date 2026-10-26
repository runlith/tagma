import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const project = sqliteTable(
  'project',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    repoKey: text('repo_key').notNull(),
    rootPath: text('root_path').notNull(),
    global: integer('global', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    removedAt: integer('removed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [uniqueIndex('project_identity_idx').on(table.repoKey)],
);
