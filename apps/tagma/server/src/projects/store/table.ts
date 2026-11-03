import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { type GroupShare, PROJECT_KINDS } from '../contract/wire/project.js';

export const project = sqliteTable(
  'project',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    repoKey: text('repo_key').notNull(),
    rootPath: text('root_path').notNull(),
    kind: text('kind', { enum: PROJECT_KINDS }).notNull().default('folder'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    removedAt: integer('removed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [uniqueIndex('project_identity_idx').on(table.repoKey)],
);

export const groupMember = sqliteTable(
  'group_member',
  {
    projectId: integer('project_id')
      .primaryKey()
      .references(() => project.id, { onDelete: 'cascade' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull(),
    withholds: text('withholds', { mode: 'json' }).$type<readonly GroupShare[]>().notNull().default([]),
    declines: text('declines', { mode: 'json' }).$type<readonly GroupShare[]>().notNull().default([]),
  },
  (table) => [index('group_member_group_idx').on(table.groupId, table.ord)],
);
