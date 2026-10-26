import { Schema } from 'effect';

export const FROZEN_TARGETS = ['surface', 'host'] as const;

export const servedSchema = Schema.Struct({
  build: Schema.String,
  root: Schema.String,
});

export const buildStateSchema = Schema.Struct({
  served: Schema.NullOr(servedSchema),
});

export const frozenStateSchema = Schema.Struct({
  surface: buildStateSchema,
  host: buildStateSchema,
});

export type FrozenTargetName = (typeof FROZEN_TARGETS)[number];
export type Served = typeof servedSchema.Type;
export type BuildState = typeof buildStateSchema.Type;
export type FrozenState = typeof frozenStateSchema.Type;
