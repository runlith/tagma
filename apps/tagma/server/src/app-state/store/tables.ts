import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const appDocument = sqliteTable('app_document', {
  key: text('key').primaryKey(),
  value: text('value'),
  revision: integer('revision').notNull(),
});
