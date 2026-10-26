import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { fileRoot } from '../../workspace/store/tables.js';

export const worktree = sqliteTable(
  'worktree',
  {
    rootId: text('root_id')
      .primaryKey()
      .references(() => fileRoot.rootId),
    projectId: integer('project_id').notNull(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    branch: text('branch'),
    baseBranch: text('base_branch'),
    baseCommit: text('base_commit').notNull(),
    hue: integer('hue').notNull(),
    origin: text('origin').notNull(),
    setup: text('setup', { enum: ['none', 'pending', 'running', 'done', 'failed'] }).notNull(),
    setupDetail: text('setup_detail'),
    taskId: text('task_id'),
    namedBy: text('named_by'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('worktree_project_name_idx').on(table.projectId, table.name), index('worktree_project_idx').on(table.projectId)],
);

export const worktreeOperation = sqliteTable(
  'worktree_operation',
  {
    operationId: text('operation_id').primaryKey(),
    namespaceId: text('namespace_id').notNull(),
    projectId: integer('project_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    repositoryRevision: integer('repository_revision').notNull(),
    destination: text('destination').notNull(),
    mode: text('mode', { enum: ['new-branch', 'existing-branch', 'detached'] }).notNull(),
    branch: text('branch'),
    start: text('start'),
    base: text('base').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    status: text('status', { enum: ['pending', 'ready', 'failed', 'uncertain'] }).notNull(),
    reserved: integer('reserved', { mode: 'boolean' }).notNull(),
    producer: text('producer'),
    rootId: text('root_id').references(() => fileRoot.rootId),
    evidence: text('evidence'),
    abandonment: text('abandonment'),
    revision: integer('revision').notNull(),
  },
  (table) => [
    index('worktree_operation_root_idx').on(table.rootId),
    uniqueIndex('worktree_operation_held_destination_idx')
      .on(table.namespaceId, table.destination)
      .where(sql`${table.reserved} = 1 and ${table.status} in ('pending', 'uncertain') and ${table.abandonment} is null`),
    uniqueIndex('worktree_operation_held_ref_idx')
      .on(table.namespaceId, table.repositoryId, table.branch)
      .where(sql`${table.reserved} = 1 and ${table.status} in ('pending', 'uncertain') and ${table.abandonment} is null`),
  ],
);

export const worktreeMerge = sqliteTable('worktree_merge', {
  dir: text('dir').primaryKey(),
  tip: text('tip').notNull(),
  base: text('base').notNull(),
  baseTime: integer('base_time').notNull(),
  driverRevision: text('driver_revision').notNull(),
  fingerprint: text('fingerprint').notNull(),
  takenAt: integer('taken_at').notNull(),
  merged: text('merged'),
  held: integer('held', { mode: 'boolean' }).notNull(),
  problem: text('problem'),
});

export const worktreeState = sqliteTable('worktree_state', {
  rootId: text('root_id')
    .primaryKey()
    .references(() => fileRoot.rootId, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  head: text('head'),
  indexStamp: text('index_stamp').notNull(),
  base: text('base'),
  takenAt: integer('taken_at').notNull(),
  state: text('state').notNull(),
});

export const DELETION_PHASES = ['intended', 'ending', 'committing', 'removing', 'placing'] as const;
export type DeletionPhase = (typeof DELETION_PHASES)[number];

export const worktreeDeletion = sqliteTable(
  'worktree_deletion',
  {
    key: text('key').primaryKey(),
    projectId: integer('project_id').notNull(),
    rootId: text('root_id').notNull(),
    phase: text('phase', { enum: DELETION_PHASES }).notNull(),
    paths: text('paths').notNull(),
    holders: text('holders').notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('worktree_deletion_root_idx').on(table.rootId), index('worktree_deletion_at_idx').on(table.at, table.key)],
);
