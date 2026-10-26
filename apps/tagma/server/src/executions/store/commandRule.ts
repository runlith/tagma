import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { type CommandRuleProgram, RULE_MEASURES } from '../contract/wire/commandRules.js';
import { project } from '../../projects/store/table.js';
import { threadRecord } from '../../thread-record/store/table.js';

export const commandRule = sqliteTable(
  'command_rule',
  {
    id: text('id').primaryKey(),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(() => threadRecord.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    through: text('through'),
    program: text('program', { mode: 'json' }).$type<CommandRuleProgram>(),
    measure: text('measure', { enum: RULE_MEASURES }).notNull(),
    limitMs: integer('limit_ms').notNull(),
    writer: text('writer').notNull(),
    writtenAt: integer('written_at', { mode: 'timestamp_ms' }).notNull(),
    words: text('words').notNull(),
  },
  (table) => [
    index('command_rule_list_idx').on(table.projectId, table.threadId, table.position),
    index('command_rule_thread_idx').on(table.threadId),
  ],
);
