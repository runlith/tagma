import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const defaultAccount = sqliteTable(
  'default_account',
  {
    principalId: text('principal_id').notNull(),
    provider: text('provider').notNull(),
    account: text('account'),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.principalId, table.provider] })],
);

export const consoleKey = sqliteTable(
  'console_key',
  {
    provider: text('provider').notNull(),
    account: text('account').notNull().default(''),
    keyValue: text('key_value').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.account] })],
);

export const accountQuotaReading = sqliteTable(
  'account_quota_reading',
  {
    provider: text('provider').notNull(),
    account: text('account').notNull(),
    enrollment: text('enrollment').notNull(),
    observation: text('observation').notNull(),
    merged: text('merged'),
  },
  (table) => [primaryKey({ columns: [table.provider, table.account] })],
);

export const adapterInstance = sqliteTable(
  'adapter_instance',
  {
    id: text('id').primaryKey(),
    adapter: text('adapter').notNull(),
    settings: text('settings').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('adapter_instance_adapter_idx').on(table.adapter, table.createdAt)],
);
