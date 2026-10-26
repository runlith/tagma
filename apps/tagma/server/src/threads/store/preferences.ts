import type { AgentApprovalMode } from '@runlith/agent/contracts';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const approvalPreference = sqliteTable('approval_preference', {
  principalId: text('principal_id').primaryKey(),
  approvalMode: text('approval_mode').$type<AgentApprovalMode>().notNull().default('trust'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});
