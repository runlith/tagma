import { Schema } from 'effect';

const landedSchema = Schema.Struct({
  status: Schema.Literal('landed'),
  version: Schema.String,
  root: Schema.String,
  build: Schema.String,
  previous: Schema.NullOr(Schema.String),
  application: Schema.String,
  launcher: Schema.String,
});
export type Landed = typeof landedSchema.Type;

const heldSchema = Schema.Struct({
  status: Schema.Literal('held'),
  version: Schema.String,
  root: Schema.String,
  build: Schema.String,
  standing: Schema.NullOr(Schema.String),
  detail: Schema.String,
});
export type Held = typeof heldSchema.Type;

const askedSchema = Schema.Struct({
  status: Schema.Literal('ask'),
  reason: Schema.Literals(['stepped-back', 'irreversible', 'failed']),
  said: Schema.String,
});
export type Asked = typeof askedSchema.Type;

export const placementSchema = Schema.Union([landedSchema, heldSchema, askedSchema]);
export type Placement = typeof placementSchema.Type;
