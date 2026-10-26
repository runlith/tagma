import { Schema } from 'effect';

export const FINDING_KINDS = ['migration-conflict', 'fork', 'layer-stale', 'upgrade-blocked'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const catalogFindingSchema = Schema.Struct({
  catalog: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(FINDING_KINDS),
  text: Schema.String,
  shipped: Schema.optional(Schema.String),
});
export type CatalogFinding = typeof catalogFindingSchema.Type;
