import type { ModelSwitches } from '@runlith/llm/models/description';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const modelPreference = sqliteTable(
  'model_preference',
  {
    principalId: text('principal_id').primaryKey(),
    provider: text('provider'),
    model: text('model'),
    reasoning: text('reasoning'),
    defaultSwitches: text('default_switches', { mode: 'json' })
      .$type<Record<string, Record<string, ModelSwitches>>>()
      .notNull()
      .default({}),
    favoriteModels: text('favorite_models', { mode: 'json' }).$type<readonly { provider: string; model: string }[]>().notNull().default([]),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [check('model_preference_selection', sql`${table.model} is null or ${table.provider} is not null`)],
);
