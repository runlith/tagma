import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { threadRecord } from '../../thread-record/store/table.js';
import { project } from '../../projects/store/table.js';
import { EnvironmentKind, EnvironmentUseStatus } from '../contract/wire/environments.js';
import { projectRows } from '../../platform/contract/service/projections.js';

export const assignmentMembership = sqliteTable(
  'assignment_membership',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    rootId: text('root_id')
      .notNull()
      .references(() => fileRoot.rootId),
    provenance: text('provenance', { enum: ['inherited', 'explicit'] }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.rootId] }), index('assignment_membership_root_idx').on(table.rootId)],
);

export const assignmentSelection = sqliteTable('assignment_selection', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  rootId: text('root_id').references(() => fileRoot.rootId),
  provenance: text('provenance', { enum: ['inherited', 'explicit', 'cleared'] }).notNull(),
  revision: integer('revision').notNull(),
});

export const placementRows = projectRows({
  id: 'workspace.placement',
  table: assignmentSelection,
  keys: ['threadId'],
  address: 'threadId',
  columns: { threadId: assignmentSelection.threadId, rootId: assignmentSelection.rootId, provenance: assignmentSelection.provenance },
});

export const environment = sqliteTable(
  'environment',
  {
    environmentId: text('environment_id').primaryKey(),
    kind: text('kind', { enum: EnvironmentKind.literals }).notNull(),
    namespaceId: text('namespace_id').notNull(),
  },
  (table) => [
    uniqueIndex('environment_namespace_idx').on(table.namespaceId),
    uniqueIndex('environment_host_idx')
      .on(table.kind)
      .where(sql`${table.kind} = 'host'`),
  ],
);

export const environmentUse = sqliteTable(
  'environment_use',
  {
    useId: text('use_id').primaryKey(),
    environmentId: text('environment_id').notNull(),
    kind: text('kind', { enum: EnvironmentKind.literals }).notNull(),
    namespaceId: text('namespace_id').notNull(),
    witnessProvider: text('witness_provider').notNull(),
    witnessFormat: text('witness_format').notNull(),
    witnessToken: text('witness_token').notNull(),
    consumerKind: text('consumer_kind').notNull(),
    consumerId: text('consumer_id').notNull(),
    outcome: text('outcome', { enum: EnvironmentUseStatus.literals }).notNull(),
  },
  (table) => [
    index('environment_use_standing_idx')
      .on(table.environmentId, table.consumerKind, table.consumerId)
      .where(sql`${table.outcome} <> 'released'`),
    index('environment_use_consumer_idx')
      .on(table.consumerKind, table.consumerId)
      .where(sql`${table.outcome} <> 'released'`),
  ],
);

export const fileRootNamespace = sqliteTable('file_root_namespace', {
  namespaceId: text('namespace_id').primaryKey(),
  revision: integer('revision').notNull(),
});

export const fileRoot = sqliteTable(
  'file_root',
  {
    rootId: text('root_id').primaryKey(),
    namespaceId: text('namespace_id')
      .notNull()
      .references(() => fileRootNamespace.namespaceId),
    path: text('path').notNull(),
    locationRevision: integer('location_revision').notNull(),
    changedRevision: integer('changed_revision').notNull().default(0),
    witnessProvider: text('witness_provider').notNull(),
    witnessFormat: text('witness_format').notNull(),
    witnessToken: text('witness_token').notNull(),
    provenance: text('provenance').notNull(),
    repositoryId: text('repository_id'),
    gitDirectory: text('git_directory'),
    state: text('state', { enum: ['active', 'replaced', 'retired'] }).notNull(),
  },
  (table) => [
    index('file_root_namespace_idx').on(table.namespaceId, table.state, table.rootId),
    index('file_root_changes_idx').on(table.namespaceId, table.changedRevision, table.rootId),
    index('file_root_repository_idx').on(table.namespaceId, table.state, table.repositoryId),
    uniqueIndex('file_root_location_idx')
      .on(table.namespaceId, table.path)
      .where(sql`${table.state} = 'active'`),
    uniqueIndex('file_root_identity_idx')
      .on(table.namespaceId, table.witnessProvider, table.witnessFormat, table.witnessToken)
      .where(sql`${table.state} = 'active'`),
    index('file_root_witness_idx').on(table.namespaceId, table.witnessProvider, table.witnessFormat, table.witnessToken),
  ],
);

export const projectRoot = sqliteTable(
  'project_root',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    rootId: text('root_id')
      .notNull()
      .references(() => fileRoot.rootId),
    origin: text('origin', { enum: ['canonical', 'worktree', 'adopted'] }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.rootId] }), index('project_root_root_idx').on(table.rootId)],
);

export const projectRootCover = sqliteTable('project_root_cover', {
  projectId: integer('project_id')
    .primaryKey()
    .references(() => project.id, { onDelete: 'cascade' }),
  namespaceId: text('namespace_id').notNull(),
  rootPath: text('root_path').notNull(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
});

export const repository = sqliteTable(
  'repository',
  {
    repositoryId: text('repository_id').primaryKey(),
    namespaceId: text('namespace_id').notNull(),
    commonDirectory: text('common_directory').notNull(),
    locationRevision: integer('location_revision').notNull(),
    witnessProvider: text('witness_provider').notNull(),
    witnessFormat: text('witness_format').notNull(),
    witnessToken: text('witness_token').notNull(),
    projectId: integer('project_id').notNull(),
    state: text('state', { enum: ['active', 'replaced'] }).notNull(),
  },
  (table) => [
    index('repository_namespace_idx').on(table.namespaceId, table.state, table.repositoryId),
    uniqueIndex('repository_location_idx')
      .on(table.namespaceId, table.commonDirectory)
      .where(sql`${table.state} = 'active'`),
    uniqueIndex('repository_identity_idx')
      .on(table.namespaceId, table.witnessProvider, table.witnessFormat, table.witnessToken)
      .where(sql`${table.state} = 'active'`),
  ],
);

export const rootUse = sqliteTable(
  'root_use',
  {
    useId: text('use_id').primaryKey(),
    namespaceId: text('namespace_id').notNull(),
    path: text('path').notNull(),
    consumerKind: text('consumer_kind').notNull(),
    consumerId: text('consumer_id').notNull(),
    mode: text('mode', { enum: ['shared', 'disruptive'] }).notNull(),
    state: text('state', { enum: ['held', 'released'] }).notNull(),
  },
  (table) => [
    index('root_use_standing_idx')
      .on(table.mode, table.useId)
      .where(sql`${table.state} = 'held'`),
  ],
);

export const rootUseHold = sqliteTable(
  'root_use_hold',
  {
    useId: text('use_id')
      .notNull()
      .references(() => rootUse.useId),
    rootId: text('root_id')
      .notNull()
      .references(() => fileRoot.rootId),
    locationRevision: integer('location_revision').notNull(),
  },
  (table) => [primaryKey({ columns: [table.useId, table.rootId] }), index('root_use_hold_root_idx').on(table.rootId)],
);
