import { Effect, Schema } from 'effect';
import { registryPart } from '../platform/contract/service/machineRegistry.js';
import { SETTABLE_SCOPES } from '../platform/contract/wire/setting.js';
import { insertRows } from '../platform/store/rows.js';
import { SettingChanges } from './contract/service/changes.js';
import { setting } from './store/table.js';

export const settingRows = registryPart({
  section: 'settings',
  fields: {
    id: Schema.Number,
    scope: Schema.Literals(SETTABLE_SCOPES),
    key: Schema.String,
    projectId: Schema.NullOr(Schema.Number),
    value: Schema.NullOr(Schema.String),
    declined: Schema.optional(Schema.Boolean),
    updatedAt: Schema.String,
  },
  tables: [setting],
  dump: (db) => Effect.map(db.select().from(setting), (rows) => rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))),
  restore: (unit, db, rows) =>
    insertRows(
      unit,
      db,
      setting,
      rows.map(({ id, scope, key, projectId, value, declined, updatedAt }) => ({
        id,
        scope,
        key,
        projectId,
        value,
        declined,
        updatedAt: new Date(updatedAt),
      })),
    ),
  signal: { key: SettingChanges, subscribe: (changes, changed) => changes.subscribe(() => changed) },
});
