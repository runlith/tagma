import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const installRefresh = sqliteTable('install_refresh', {
  build: text('build').primaryKey(),
  refreshedAt: integer('refreshed_at', { mode: 'timestamp_ms' }).notNull(),
});
