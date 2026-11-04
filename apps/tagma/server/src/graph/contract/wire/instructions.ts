import { Schema } from 'effect';

export const instructionSchema = Schema.Struct({
  source: Schema.String,
  revision: Schema.String,
  kind: Schema.Literals(['catalog', 'tag', 'law']),
  scope: Schema.String,
  text: Schema.String,
});
export type Instruction = typeof instructionSchema.Type;

export const instructionSetSchema = Schema.Struct({
  projectId: Schema.Number,
  root: Schema.String,
  complete: Schema.Literal(true),
  audience: Schema.Literals(['graph', 'executor', 'reader']),
  entries: Schema.Array(instructionSchema),
});
export type InstructionSet = typeof instructionSetSchema.Type;

export const instructionRefSchema = Schema.Struct({
  kind: instructionSchema.fields.kind,
  source: Schema.String,
  scope: Schema.String,
  revision: Schema.String,
});
export type InstructionRef = typeof instructionRefSchema.Type;

export const instructionStateSchema = Schema.Struct({
  delivered: Schema.NullOr(
    Schema.Struct({
      projectId: Schema.Number,
      root: Schema.String,
      audience: instructionSetSchema.fields.audience,
      entries: Schema.Number,
    }),
  ),
  current: Schema.Struct({ audience: instructionSetSchema.fields.audience, entries: Schema.Number }),
  pending: Schema.Array(instructionRefSchema),
  withdrawn: Schema.Array(instructionRefSchema),
});
export type InstructionState = typeof instructionStateSchema.Type;
