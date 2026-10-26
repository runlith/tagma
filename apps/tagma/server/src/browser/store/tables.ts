import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { project } from '../../projects/store/table.js';
import type { PageId, ProfileId } from '../contract/wire/ids.js';
import type { Download, History } from '../contract/wire/page.js';
import { CONSOLE_CAPTURES, REMOVALS } from '../contract/wire/profile.js';

export const browserProfile = sqliteTable('browser_profile', {
  id: text('id').$type<ProfileId>().primaryKey(),
  name: text('name').notNull(),
  adapter: text('adapter').notNull(),
  document: text('document', { mode: 'json' }).$type<unknown>().notNull(),
  console: text('console', { enum: CONSOLE_CAPTURES }).notNull(),
  removal: text('removal', { enum: REMOVALS }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const browserPage = sqliteTable(
  'browser_page',
  {
    id: text('id').$type<PageId>().primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    profile: text('profile')
      .$type<ProfileId>()
      .notNull()
      .references(() => browserProfile.id, { onDelete: 'cascade' }),
    context: text('context'),
    url: text('url').notNull(),
    title: text('title').notNull(),
    favicon: text('favicon'),
    openedBy: text('opened_by'),
    opener: text('opener').$type<PageId>(),
    history: text('history', { mode: 'json' }).$type<History>(),
    downloads: text('downloads', { mode: 'json' }).$type<readonly Download[]>().notNull(),
    activeAt: integer('active_at', { mode: 'timestamp_ms' }).notNull(),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('browser_page_project_idx').on(table.projectId, table.closedAt, table.activeAt, table.id),
    index('browser_page_profile_idx').on(table.profile),
  ],
);
