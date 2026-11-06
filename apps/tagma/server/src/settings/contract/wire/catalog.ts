import { ASK_KINDS } from '@runlith/llm/models/description';
import { Schema } from 'effect';
import type { SessionRef } from '../../../platform/contract/wire/session.js';
import {
  SETTABLE_SCOPES,
  SETTING_MERGES,
  SETTING_SCOPES,
  SETTING_UNITS,
  type SettableScope,
  type SettingControl,
  type SettingLayers,
  type SettingMerge,
  type SettingScope,
} from '../../../platform/contract/wire/setting.js';

export type SettingRejection = {
  readonly key: string;
  readonly scope: SettableScope;
  readonly reason: string;
};

export type SettingEntry = {
  readonly id: string;
  readonly section: string;
  readonly title: string;
  readonly description: string;
  readonly shape: string;
  readonly control?: SettingControl;
  readonly scopes: readonly SettableScope[];
  readonly merge: SettingMerge;
  readonly value: unknown;
  readonly from: SettingScope;
  readonly fallback: unknown;
  readonly layers: SettingLayers;
  readonly writer?: SessionRef;
  readonly operatorOnly?: true;
};

const sectionSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
});

const choiceSchema = Schema.Struct({ value: Schema.String, label: Schema.String, hint: Schema.String });

const colorSlotSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  hint: Schema.optional(Schema.String),
});

const colorGroupSchema = Schema.Struct({ label: Schema.String, slots: Schema.Array(colorSlotSchema) });

const fieldConditionSchema = Schema.Struct({ path: Schema.Array(Schema.String), equals: Schema.String });

const fieldSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('model'),
    path: Schema.Tuple([Schema.String, Schema.String]),
    label: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal('ask'), of: Schema.Literals(ASK_KINDS), label: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('share'),
    path: Schema.Tuple([Schema.String]),
    label: Schema.String,
    minimum: Schema.Number,
    maximum: Schema.Number,
    reference: Schema.optional(Schema.Struct({ ceiling: Schema.Number, of: Schema.String })),
    when: Schema.optional(fieldConditionSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('choice'),
    path: Schema.Tuple([Schema.String]),
    label: Schema.String,
    choices: Schema.Array(choiceSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('text'),
    path: Schema.Tuple([Schema.String]),
    label: Schema.String,
    placeholder: Schema.optional(Schema.String),
  }),
]);

const controlSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('choice'),
    choices: Schema.Array(choiceSchema),
    multiple: Schema.optional(Schema.Literal(true)),
  }),
  Schema.Struct({
    kind: Schema.Literal('slider'),
    minimum: Schema.Number,
    maximum: Schema.Number,
    step: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal('share'),
    minimum: Schema.Number,
    maximum: Schema.Number,
    reference: Schema.optional(Schema.Struct({ ceiling: Schema.Number, of: Schema.String })),
  }),
  Schema.Struct({
    kind: Schema.Literal('number'),
    minimum: Schema.Number,
    maximum: Schema.optional(Schema.Number),
    step: Schema.Number,
    unit: Schema.Literals(SETTING_UNITS),
  }),
  Schema.Struct({ kind: Schema.Literal('catalog'), of: Schema.String.check(Schema.isMinLength(1)) }),
  Schema.Struct({ kind: Schema.Literal('ask'), of: Schema.Literals(ASK_KINDS) }),
  Schema.Struct({ kind: Schema.Literal('colors'), groups: Schema.Array(colorGroupSchema) }),
  Schema.Struct({
    kind: Schema.Literal('rows'),
    fields: Schema.Array(fieldSchema),
    merging: Schema.optional(Schema.Literal(true)),
  }),
  Schema.Struct({ kind: Schema.Literal('machine') }),
  Schema.Struct({
    kind: Schema.Literal('managed'),
    by: Schema.String,
  }),
]);

const writerSchema = Schema.Struct({ harness: Schema.String, key: Schema.String });

const layerAnswerSchema = Schema.Struct({
  value: Schema.optional(Schema.Unknown),
  declined: Schema.Boolean,
  writer: Schema.optional(writerSchema),
  operatorOnly: Schema.optional(Schema.Literal(true)),
});

const entrySchema = Schema.Struct({
  id: Schema.String,
  section: Schema.String,
  title: Schema.String,
  description: Schema.String,
  shape: Schema.String,
  control: Schema.optional(controlSchema),
  scopes: Schema.Array(Schema.Literals(SETTABLE_SCOPES)),
  merge: Schema.Literals(SETTING_MERGES),
  value: Schema.Unknown,
  from: Schema.Literals(SETTING_SCOPES),
  fallback: Schema.Unknown,
  layers: Schema.Struct({
    user: Schema.optional(layerAnswerSchema),
    project: Schema.optional(layerAnswerSchema),
  }),
  writer: Schema.optional(writerSchema),
});

const rejectionSchema = Schema.Struct({
  key: Schema.String,
  scope: Schema.Literals(SETTABLE_SCOPES),
  reason: Schema.String,
});

export const settingCatalogSchema = Schema.Struct({
  sections: Schema.Array(sectionSchema),
  entries: Schema.Array(entrySchema),
  rejections: Schema.Array(rejectionSchema),
});
