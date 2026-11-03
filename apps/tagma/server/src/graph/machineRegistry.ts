import { Effect, Schema } from 'effect';
import { sql } from 'drizzle-orm';
import { registryPart } from '../platform/contract/service/machineRegistry.js';
import { STORAGE_MODES } from '../projects/contract/wire/project.js';
import { ProjectPolicy } from './contract/service/serving.js';
import { projectPolicy, projectsWithPolicy } from './store/policy.js';

export const policyRows = registryPart({
  section: 'projects',
  fields: {
    id: Schema.Number,
    strictProvenance: Schema.optional(Schema.Boolean),
    private: Schema.optional(Schema.Boolean),
    storage: Schema.Literals([...STORAGE_MODES, 'plain']),
  },
  tables: [projectPolicy],
  dump: (unit, db) =>
    Effect.map(unit.run(projectsWithPolicy(db)), (rows) =>
      rows.map(({ id, strictProvenance, private: hidden, storage }) => ({ id, strictProvenance, private: hidden, storage })),
    ),
  restore: Effect.fnUntraced(function* (unit, db, rows) {
    if (rows.length === 0) return;
    const split = yield* unit.run(db.all<{ found: number }>(sql`select count(*) as found from pragma_table_info('project_policy')`));
    if ((split[0]?.found ?? 0) > 0) {
      for (const row of rows) {
        yield* unit.run(
          db.run(sql`insert into project_policy (project_id, strict_provenance, private, storage)
        values (${row.id}, ${row.strictProvenance ? 1 : 0}, ${row.private ? 1 : 0}, ${row.storage})`),
        );
      }
      return;
    }
    for (const row of rows) {
      yield* unit.run(
        db.run(
          sql`update project set strict_provenance = ${row.strictProvenance ? 1 : 0}, private = ${row.private ? 1 : 0}, storage = ${row.storage} where id = ${row.id}`,
        ),
      );
    }
  }),
  signal: { key: ProjectPolicy, subscribe: (policy, changed) => policy.subscribe(() => changed) },
});
