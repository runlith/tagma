import type { WorkflowPlan } from '@runlith/agent/workflow/plan';
import type { WorkflowRun, WorkflowStepRecord } from '@runlith/agent/workflow/run';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { project } from '../../projects/store/table.js';

export const workflowRun = sqliteTable(
  'workflow_run',
  {
    id: text('id').primaryKey(),
    workflow: text('workflow').notNull(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    thread: text('thread').notNull(),
    plan: text('plan', { mode: 'json' }).$type<WorkflowPlan>().notNull(),
    input: text('input', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<WorkflowRun['status']>().notNull().default('running'),
    records: text('records', { mode: 'json' }).$type<readonly WorkflowStepRecord[]>().notNull(),
    lease: text('lease', { mode: 'json' }).$type<WorkflowRun['lease']>(),
    reason: text('reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('workflow_run_project_idx').on(table.projectId, table.createdAt)],
);
