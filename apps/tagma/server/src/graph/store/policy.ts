import { eq, getTableColumns, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { StoreBrand, StoreDb } from '../../platform/contract/service/store.js';
import { project } from '../../projects/store/table.js';
import { STORAGE_MODES, type StorageMode } from '../../projects/contract/wire/project.js';

export const projectPolicy = sqliteTable('project_policy', {
  projectId: integer('project_id')
    .primaryKey()
    .references(() => project.id, { onDelete: 'cascade' }),
  strictProvenance: integer('strict_provenance', { mode: 'boolean' }).notNull().default(false),
  private: integer('private', { mode: 'boolean' }).notNull().default(false),
  storage: text('storage', { enum: STORAGE_MODES }).notNull().default('stealth'),
});

export type PolicyFields = Partial<Pick<typeof projectPolicy.$inferInsert, 'strictProvenance' | 'private' | 'storage'>>;

const POLICY_ROW = {
  ...getTableColumns(project),
  strictProvenance: sql<boolean>`coalesce(${projectPolicy.strictProvenance}, 0)`.mapWith(projectPolicy.strictProvenance),
  private: sql<boolean>`coalesce(${projectPolicy.private}, 0)`.mapWith(projectPolicy.private),
  storage: sql<StorageMode>`coalesce(${projectPolicy.storage}, 'stealth')`,
};

export const projectsWithPolicy = <Brand extends StoreBrand>(db: StoreDb<Brand>) =>
  db.select(POLICY_ROW).from(project).leftJoin(projectPolicy, eq(projectPolicy.projectId, project.id));

export const writePolicy = <Brand extends StoreBrand>(db: StoreDb<Brand>, projectId: number, fields: PolicyFields) =>
  db
    .insert(projectPolicy)
    .values({ projectId, ...fields })
    .onConflictDoUpdate({ target: projectPolicy.projectId, set: fields });
