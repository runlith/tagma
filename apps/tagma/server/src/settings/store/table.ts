import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { SETTABLE_SCOPES } from '../../platform/contract/wire/setting.js';
import { session } from '../../platform/store/writers.js';
import { project } from '../../projects/store/table.js';

export const setting = sqliteTable(
  'setting',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    scope: text('scope', { enum: SETTABLE_SCOPES }).notNull(),
    projectId: integer('project_id').references(() => project.id),
    key: text('key').notNull(),
    value: text('value'),
    declined: integer('declined', { mode: 'boolean' }).notNull().default(false),
    sessionId: integer('session_id').references(() => session.id),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('setting_identity_idx').on(
      table.scope,
      table.key,
      sql`case when ${table.projectId} is null then 0 else ${table.projectId} end`,
    ),
  ],
);
