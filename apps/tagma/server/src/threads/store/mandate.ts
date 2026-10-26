import type { ThreadBindings } from '@runlith/agent/contracts';
import type { TeamLayer } from '@runlith/agent/collaboration/team';
import type { ThreadAuthority } from '@runlith/agent/thread/rows';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { threadRecord } from '../../thread-record/store/table.js';

export const threadMandate = sqliteTable(
  'thread_mandate',
  {
    id: text('id')
      .primaryKey()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    authority: text('authority', { mode: 'json' }).$type<ThreadAuthority>().notNull(),
    delegation: integer('delegation', { mode: 'boolean' }),
    operatorNotice: integer('operator_notice', { mode: 'boolean' }),
    approves: text('approves', { mode: 'json' }).$type<readonly string[] | null>(),
    team: text('team', { mode: 'json' }).$type<TeamLayer | null>(),
    takenOver: integer('taken_over', { mode: 'boolean' }).notNull().default(false),
    plain: integer('plain', { mode: 'boolean' }).notNull().default(false),
    budgetTokens: integer('budget_tokens'),
    hostKind: text('host_kind'),
    hostId: text('host_id'),
    bindings: text('bindings', { mode: 'json' }).$type<ThreadBindings>().notNull().default({}),
  },
  (table) => [index('thread_mandate_host_idx').on(table.hostKind, table.hostId)],
);

export const threadLiveSpell = sqliteTable('thread_live_spell', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
});
