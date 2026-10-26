import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { RUN_OUTCOMES } from '../contract/wire/schedule.js';

export const scheduleRun = sqliteTable(
  'schedule_run',
  {
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    everyMs: integer('every_ms').notNull(),
    nextAt: integer('next_at').notNull(),
    lastStartedAt: integer('last_started_at'),
    lastEndedAt: integer('last_ended_at'),
    lastOutcome: text('last_outcome', { enum: RUN_OUTCOMES }),
    lastReason: text('last_reason'),
    lastSkipped: integer('last_skipped'),
  },
  (table) => [primaryKey({ columns: [table.owner, table.name] })],
);
