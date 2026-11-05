import { Schema } from 'effect';
import type { ChangeActor } from '../../../platform/contract/wire/actor.js';

const instructionOriginSchema = Schema.Struct({ projectId: Schema.Number, block: Schema.String });

export const instructionSchema = Schema.Struct({
  source: Schema.String,
  revision: Schema.String,
  kind: Schema.Literals(['catalog', 'tag', 'law']),
  scope: Schema.String,
  text: Schema.String,
  origin: Schema.optional(instructionOriginSchema),
});
export type Instruction = typeof instructionSchema.Type;

export const instructionSetSchema = Schema.Struct({
  projectId: Schema.Number,
  root: Schema.String,
  complete: Schema.Literal(true),
  audience: Schema.Literals(['graph', 'executor', 'reader']),
  entries: Schema.Array(instructionSchema),
  journal: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
});
export type InstructionSet = typeof instructionSetSchema.Type;

export type InstructionChanges = {
  readonly basis: 'none' | 'other-world' | 'same-world';
  readonly pending: readonly Instruction[];
  readonly withdrawn: readonly Instruction[];
  readonly by: ReadonlyMap<string, readonly ChangeActor[]>;
};

export type InstructionDiff = { readonly set: InstructionSet; readonly changes: InstructionChanges };

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
