import { Schema } from 'effect';

export const migrationLoadSchema = Schema.Struct({
  migrations: Schema.Array(Schema.Struct({ name: Schema.String, reason: Schema.String })),
  tables: Schema.Array(Schema.Struct({ name: Schema.String, maxRowid: Schema.NullOr(Schema.Finite), snapshot: Schema.Boolean })),
  files: Schema.Array(
    Schema.Struct({ owner: Schema.String, bytes: Schema.NullOr(Schema.Finite), hashPasses: Schema.NullOr(Schema.Finite) }),
  ),
});
export type MigrationLoad = typeof migrationLoadSchema.Type;

export const migrationLoadText = (load: MigrationLoad): string =>
  [
    `Heavy update: ${load.migrations.map((migration) => `${migration.name} — ${migration.reason}`).join('; ')}`,
    ...load.tables.map(
      (table) => `${table.name}: rowid bound ${table.maxRowid ?? 'unknown'}${table.snapshot ? ', snapshot included' : ''}`,
    ),
    ...load.files.map(
      (file) =>
        `${file.owner}: ${file.bytes === null ? 'unmeasured bytes' : `${file.bytes} bytes`}, ${file.hashPasses ?? 'unknown'} hash passes`,
    ),
    'Measured before handover; later writes can increase the work.',
  ].join('\n');
