import type { ThreadBornOf } from '@runlith/agent/protocol/birth';
import type { ThreadStatus } from '@runlith/agent/thread/rows';
import { sql } from 'drizzle-orm';
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import type { ThreadRecap } from '../contract/wire/recap.js';
import type { TitleProvenance } from '../contract/wire/title.js';
import { project } from '../../projects/store/table.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { session } from '../../platform/store/writers.js';
import { threadFolder } from './folders.js';
import { projectRows } from '../../platform/contract/service/projections.js';

export const threadRecord = sqliteTable(
  'thread',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    origin: text('origin').$type<'scoped' | 'unscoped'>().notNull(),
    parentId: text('parent_id').references((): AnySQLiteColumn => threadRecord.id, { onDelete: 'cascade' }),
    spawnRootId: text('spawn_root_id').notNull(),
    detachedFrom: text('detached_from').references((): AnySQLiteColumn => threadRecord.id, { onDelete: 'set null' }),
    detachedAt: integer('detached_at', { mode: 'timestamp_ms' }),
    principalId: text('principal_id').notNull(),
    name: text('name'),
    title: text('title').notNull().default('New thread'),
    titleOrigin: text('title_origin').$type<TitleProvenance>().notNull().default('random'),
    titleRevision: integer('title_revision').notNull().default(0),
    titleAskedInput: text('title_asked_input'),
    harness: text('harness').notNull().default(NATIVE_HARNESS),
    agentId: text('agent_id').notNull(),
    bornOf: text('born_of', { mode: 'json' }).$type<ThreadBornOf>(),
    spawnedByRunId: text('spawned_by_run_id'),
    createdBy: text('created_by'),
    scopeBlockUuid: text('scope_block_uuid'),
    createdBySessionId: integer('created_by_session_id').references(() => session.id),
    readerOrderAt: integer('reader_order_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    pinnedAt: integer('pinned_at', { mode: 'timestamp_ms' }),
    folderId: text('folder_id').references(() => threadFolder.id, { onDelete: 'set null' }),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    status: text('status').$type<ThreadStatus>().notNull().default('idle'),
    runningRunId: text('running_run_id'),
    movedAt: integer('moved_at', { mode: 'timestamp_ms' }),
    recap: text('recap', { mode: 'json' }).$type<ThreadRecap>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check('thread_origin', sql`(${table.origin} = 'unscoped') = (${table.projectId} is null)`),
    uniqueIndex('thread_name_unique').on(table.principalId, table.spawnRootId, table.name),
    index('thread_parent_idx').on(table.parentId, table.createdAt),
    index('thread_spawn_root_idx').on(table.spawnRootId, table.createdAt),
    index('thread_detached_idx')
      .on(table.detachedFrom)
      .where(sql`${table.detachedFrom} is not null`),
    index('thread_project_idx').on(table.projectId, table.createdAt),
    index('thread_reader_order_idx')
      .on(table.projectId, table.readerOrderAt)
      .where(sql`${table.archivedAt} is null`),
    index('thread_archived_idx').on(table.projectId, table.archivedAt),
    index('thread_pinned_idx')
      .on(table.projectId, table.pinnedAt)
      .where(sql`${table.pinnedAt} is not null`),
    index('thread_folder_idx')
      .on(table.projectId, table.folderId)
      .where(sql`${table.folderId} is not null`),
  ],
);

export const recordRows = projectRows({
  id: 'thread-record.record',
  table: threadRecord,
  keys: ['id'],
  address: 'id',
  context: ['projectId', 'parentId', 'principalId', 'archivedAt'],
  columns: {
    id: threadRecord.id,
    projectId: threadRecord.projectId,
    parentId: threadRecord.parentId,
    spawnRootId: threadRecord.spawnRootId,
    detachedFrom: threadRecord.detachedFrom,
    principalId: threadRecord.principalId,
    name: threadRecord.name,
    title: threadRecord.title,
    titleOrigin: threadRecord.titleOrigin,
    agentId: threadRecord.agentId,
    bornOf: threadRecord.bornOf,
    spawnedByRunId: threadRecord.spawnedByRunId,
    createdBy: threadRecord.createdBy,
    scopeBlockUuid: threadRecord.scopeBlockUuid,
    createdBySessionId: threadRecord.createdBySessionId,
    readerOrderAt: threadRecord.readerOrderAt,
    pinnedAt: threadRecord.pinnedAt,
    folderId: threadRecord.folderId,
    archivedAt: threadRecord.archivedAt,
    status: threadRecord.status,
    movedAt: threadRecord.movedAt,
    recap: threadRecord.recap,
    createdAt: threadRecord.createdAt,
  },
});
