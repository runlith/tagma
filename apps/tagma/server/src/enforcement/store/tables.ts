import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { project } from '../../projects/store/table.js';

export const remeasureLanding = sqliteTable(
  'remeasure_landing',
  {
    key: text('key').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    root: text('root').notNull(),
    payload: text('payload').notNull(),
    parked: text('parked'),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('remeasure_landing_project_idx').on(table.projectId)],
);

export const ruleRefusal = sqliteTable(
  'rule_refusal',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    op: text('op').notNull(),
    file: text('file').notNull(),
    line: integer('line'),
    fingerprint: text('fingerprint').notNull(),
    reached: text('reached'),
    said: text('said'),
    fix: text('fix'),
    base: text('base'),
    branch: text('branch'),
    actor: text('actor'),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('rule_refusal_project_at_idx').on(table.projectId, table.at),
    index('rule_refusal_rule_at_idx').on(table.projectId, table.rule, table.at),
  ],
);
