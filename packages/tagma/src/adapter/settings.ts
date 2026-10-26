import { Schema } from 'effect';

const option = Schema.Struct({ id: Schema.String, label: Schema.String });
const base = {
  id: Schema.String,
  label: Schema.String,
  hint: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Literal(true)),
  secret: Schema.optional(Schema.Literal(true)),
};

export const settingLeafSchema = Schema.Union([
  Schema.Struct({ ...base, type: Schema.Literal('text'), placeholder: Schema.optional(Schema.String) }),
  Schema.Struct({
    ...base,
    type: Schema.Literal('number'),
    min: Schema.optional(Schema.Number),
    unit: Schema.optional(Schema.String),
    placeholder: Schema.optional(Schema.String),
  }),
  Schema.Struct({ ...base, type: Schema.Literal('flag') }),
  Schema.Struct({ ...base, type: Schema.Literal('choice'), options: Schema.Array(option), default: Schema.optional(Schema.String) }),
  Schema.Struct({ ...base, type: Schema.Literal('set'), options: Schema.Array(option) }),
]);
export type SettingLeaf = typeof settingLeafSchema.Type;

export const settingFieldSchema = Schema.Union([
  settingLeafSchema,
  Schema.Struct({
    ...base,
    type: Schema.Literal('rows'),
    noun: Schema.String,
    fields: Schema.Array(settingLeafSchema),
    discoverable: Schema.optional(Schema.Literal(true)),
  }),
]);
export type SettingField = typeof settingFieldSchema.Type;
