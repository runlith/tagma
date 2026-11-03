import { Effect, Schema } from 'effect';
import { registryPart } from '../platform/contract/service/machineRegistry.js';
import { insertRows } from '../platform/store/rows.js';
import { ProjectChanges } from './contract/service/changes.js';
import { PROJECT_KINDS } from './contract/wire/project.js';
import { groupMember, project } from './store/table.js';

export const projectRows = registryPart({
  section: 'projects',
  fields: {
    id: Schema.Number,
    name: Schema.String,
    repoKey: Schema.String,
    rootPath: Schema.String,
    createdAt: Schema.String,
    kind: Schema.optional(Schema.Literals(PROJECT_KINDS)),
    global: Schema.optional(Schema.Boolean),
    removedAt: Schema.optional(Schema.NullOr(Schema.String)),
  },
  tables: [project],
  dump: (db) =>
    Effect.map(db.select().from(project), (rows) =>
      rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), removedAt: row.removedAt?.toISOString() ?? null })),
    ),
  restore: (unit, db, rows) =>
    insertRows(
      unit,
      db,
      project,
      rows.map(({ id, name, repoKey, rootPath, createdAt, kind, global, removedAt }) => ({
        id,
        name,
        repoKey,
        rootPath,
        createdAt: new Date(createdAt),
        kind: kind ?? (global === true ? 'global' : 'folder'),
        removedAt: removedAt == null ? null : new Date(removedAt),
      })),
    ),
  signal: { key: ProjectChanges, subscribe: (changes, changed) => changes.changed.subscribe(changed) },
});

export const memberRows = registryPart({
  section: 'members',
  fields: { projectId: Schema.Number, groupId: Schema.Number, ord: Schema.Number },
  optional: true,
  tables: [groupMember],
  dump: (db) => db.select().from(groupMember),
  restore: (unit, db, rows) => insertRows(unit, db, groupMember, rows),
});
