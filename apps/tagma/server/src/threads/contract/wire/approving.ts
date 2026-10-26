import { Schema } from 'effect';

export const approvingSchema = Schema.Struct({
  approver: Schema.NullOr(Schema.String),
  why: Schema.Literals(['taken-over', 'parent', 'no-grant', 'no-parent']),
  takenOver: Schema.Boolean,
  approves: Schema.Struct({
    own: Schema.NullOr(Schema.Array(Schema.String)),
    effective: Schema.Array(Schema.String),
    origin: Schema.Literals(['own', 'lineage', 'setting']),
    setAt: Schema.NullOr(Schema.String),
  }),
});
export type Approving = typeof approvingSchema.Type;
