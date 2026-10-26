import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import type { SandboxManifest, GuestReceipt, SandboxState } from '../contract/wire/sandbox.js';
import type { PreparationReceipt, PreparedTreeManifest, PreparedTreeState } from '../contract/wire/preparedTree.js';
import { project } from '../../projects/store/table.js';
import { threadRecord } from '../../thread-record/store/table.js';

export const sandbox = sqliteTable(
  'sandbox',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),
    state: text('state').$type<SandboxState>().notNull().default('preparing'),
    boundThreadId: text('bound_thread_id').references(() => threadRecord.id, { onDelete: 'set null' }),
    runtime: text('runtime', { mode: 'json' }).$type<GuestReceipt>().notNull(),
    manifest: text('manifest', { mode: 'json' }).$type<SandboxManifest>(),
    failureReason: text('failure_reason'),
    exportPath: text('export_path'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('sandbox_thread_unique').on(table.boundThreadId),
    index('sandbox_project_idx').on(table.projectId, table.createdAt),
    index('sandbox_state_idx').on(table.state),
  ],
);

export const preparedTree = sqliteTable(
  'prepared_tree',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),
    state: text('state').$type<PreparedTreeState>().notNull().default('building'),
    receipt: text('receipt', { mode: 'json' }).$type<PreparationReceipt>().notNull(),
    manifest: text('manifest', { mode: 'json' }).$type<PreparedTreeManifest>(),
    archivePath: text('archive_path'),
    resourcesReleased: integer('resources_released', { mode: 'boolean' }).notNull().default(false),
    cleanupReason: text('cleanup_reason'),
    failureReason: text('failure_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('prepared_tree_project_idx').on(table.projectId, table.createdAt), index('prepared_tree_state_idx').on(table.state)],
);
