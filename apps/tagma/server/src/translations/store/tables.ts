import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const ACT_ENDINGS = ['done', 'failed'] as const;

export const translationPart = sqliteTable(
  'translation_part',
  {
    projectId: integer('project_id').notNull(),
    block: text('block').notNull(),
    language: text('language').notNull(),
    source: text('source').notNull(),
    text: text('text').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.block, table.language, table.source] })],
);

export const translationAct = sqliteTable(
  'translation_act',
  {
    projectId: integer('project_id').notNull(),
    block: text('block').notNull(),
    language: text('language').notNull(),
    model: text('model').notNull(),
    rung: text('rung'),
    at: integer('at').notNull(),
    ending: text('ending', { enum: ACT_ENDINGS }),
    reason: text('reason'),
    failed: integer('failed').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.block, table.language] })],
);
