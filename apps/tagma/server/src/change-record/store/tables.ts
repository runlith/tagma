import { sql, type SQL } from 'drizzle-orm';
import { alias, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import { project } from '../../projects/store/table.js';
import { writes } from '../../platform/contract/service/writes.js';

export const ROW_STATES = ['writing', 'held', 'committed', 'withdrawn'] as const;

export type RowState = (typeof ROW_STATES)[number];

export const workspaceChange = sqliteTable(
  'workspace_change',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    holderProjectId: integer('holder_project_id'),
    holder: text('holder').notNull(),
    runId: text('run_id'),
    checkout: text('checkout').notNull(),
    path: text('path').notNull(),
    movedFrom: text('moved_from'),
    head: text('head'),
    state: text('state', { enum: ROW_STATES }).notNull(),
    reason: text('reason'),
    origin: text('origin', { enum: ['edit', 'write', 'delete'] }).notNull(),
    provenance: text('provenance', { enum: ['typed', 'command', 'command-whole'] }),
    commandLine: text('command_line'),
    mode: text('mode'),
    firstLine: integer('first_line'),
    lines: integer('lines'),
    oldLines: integer('old_lines'),
    windowBefore: integer('window_before'),
    reverts: text('reverts', { mode: 'json' }).$type<readonly string[]>(),
    beforeHash: text('before_hash'),
    afterHash: text('after_hash'),
    added: integer('added'),
    removed: integer('removed'),
    at: integer('at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    committedAt: integer('committed_at', { mode: 'timestamp_ms' }),
    commit: text('commit'),
    withdrawnAt: integer('withdrawn_at', { mode: 'timestamp_ms' }),
    commitCall: text('commit_call'),
    recordKey: text('record_key'),
  },
  (table) => [
    index('workspace_change_project_idx').on(table.projectId),
    index('workspace_change_place_idx').on(table.checkout, table.path),
    uniqueIndex('workspace_change_record_key_idx').on(table.holder, table.recordKey),
    index('workspace_change_holder_idx').on(table.holder, table.at),
    index('workspace_change_holder_path_idx').on(table.holder, table.path),
    index('workspace_change_held_place_idx')
      .on(table.checkout, table.path)
      .where(sql`${table.state} = 'held'`),
    index('workspace_change_standing_order_idx')
      .on(table.checkout, table.path, table.at, table.id)
      .where(sql`${table.state} in ('writing', 'held')`),
    index('workspace_change_ended_order_idx')
      .on(table.checkout, table.path, table.at, table.id)
      .where(sql`${table.state} in ('committed', 'withdrawn')`),
    index('workspace_change_held_folded_idx')
      .on(table.checkout, sql`lower(${table.path})`)
      .where(sql`${table.state} in ('writing', 'held')`),
    index('workspace_change_checkout_at_idx').on(table.checkout, table.at),
    index('workspace_change_moved_from_idx')
      .on(table.checkout, table.movedFrom)
      .where(sql`${table.state} in ('writing', 'held') and ${table.movedFrom} is not null`),
    index('workspace_change_project_held_idx')
      .on(table.projectId, table.at)
      .where(sql`${table.state} = 'held'`),
    index('workspace_change_writing_idx')
      .on(table.checkout)
      .where(sql`${table.state} = 'writing'`),
    index('workspace_change_held_before_idx')
      .on(table.beforeHash)
      .where(sql`${table.state} in ('writing', 'held')`),
    index('workspace_change_held_after_idx')
      .on(table.afterHash)
      .where(sql`${table.state} in ('writing', 'held')`),
  ],
);

export const workspaceChangeText = sqliteTable('workspace_change_text', {
  row: text('row')
    .primaryKey()
    .notNull()
    .references(() => workspaceChange.id, { onDelete: 'cascade' }),
  oldText: text('old_text'),
  newText: text('new_text'),
});

export const workspaceChangeRetiredText = sqliteTable('workspace_change_retired_text', {
  row: text('row')
    .primaryKey()
    .notNull()
    .references(() => workspaceChangeText.row, { onDelete: 'cascade' }),
});

export const workspaceChangeContent = sqliteTable('workspace_change_content', {
  digest: text('digest').primaryKey(),
  text: text('text').notNull(),
  bytes: integer('bytes').notNull(),
  at: integer('at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const workspaceChangeReleased = sqliteTable('workspace_change_released', {
  digest: text('digest').primaryKey(),
});

export const held: SQL = sql`${workspaceChange.state} = 'held'`;

export const standing: SQL = sql`${workspaceChange.state} in ('writing', 'held')`;

const earlier = alias(workspaceChange, 'earlier');

export const followsStanding: SQL = sql`exists(select 1 from ${workspaceChange} as ${earlier} where ${earlier.checkout} = ${workspaceChange.checkout} and ${earlier.path} = ${workspaceChange.path} and ${earlier.state} in ('writing', 'held') and (${earlier.at} < ${workspaceChange.at} or (${earlier.at} = ${workspaceChange.at} and ${earlier.id} < ${workspaceChange.id})))`;

export const retiredWithTexts: SQL = sql`${workspaceChange.state} in ('committed', 'withdrawn') and exists(select 1 from ${workspaceChangeText} where ${workspaceChangeText.row} = ${workspaceChange.id})`;

export const changeLogWrites = writes('WorkspaceChangeLog', [
  workspaceChange,
  workspaceChangeText,
  workspaceChangeRetiredText,
  workspaceChangeContent,
  workspaceChangeReleased,
]);
