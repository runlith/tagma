import { ToolChoiceMode } from '@runlith/llm/schema/options';
import { CACHE_GAP_BUCKETS } from '@runlith/llm/models/cacheLifetime';
import { MODEL_CAPABILITIES } from '@runlith/llm/models/description';
import { Schema } from 'effect';
import { settingFieldSchema } from '@runlith/tagma/adapter/settings';
import { feed } from '../../../platform/contract/wire/operation.js';

const switchSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  values: Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String })),
  default: Schema.NullOr(Schema.String),
  icon: Schema.optional(Schema.String),
});

const capacitySchema = Schema.Struct({
  context: Schema.Number,
  input: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
});

const servedModelSchema = Schema.Struct({
  label: Schema.String,
  short: Schema.optional(Schema.String),
  capacity: Schema.optional(capacitySchema),
  capabilities: Schema.Array(Schema.Literals(MODEL_CAPABILITIES)),
  toolChoice: Schema.optional(Schema.Array(ToolChoiceMode)),
  reasoning: Schema.Array(Schema.String),
  defaultReasoning: Schema.NullOr(Schema.String),
  switches: Schema.optional(Schema.Array(switchSchema)),
  compactionTrigger: Schema.optional(
    Schema.Union([
      Schema.Struct({ strategy: Schema.Literal('percent'), trigger: Schema.Number }),
      Schema.Struct({ strategy: Schema.Literal('reserve-output') }),
    ]),
  ),
  servedAs: Schema.optional(Schema.String),
  aliases: Schema.optional(Schema.Array(Schema.String)),
  supportsAdaptiveThinking: Schema.optional(Schema.Boolean),
  operatorOnly: Schema.optional(Schema.Literal(true)),
});

const servedImageModelSchema = Schema.Struct({
  label: Schema.String,
  inputs: Schema.Int,
  inputTypes: Schema.Array(Schema.String),
  transparent: Schema.Boolean,
});

const cacheLifetimeSchema = Schema.Struct({
  promisedSeconds: Schema.NullOr(Schema.Number),
  prior: Schema.NullOr(
    Schema.Struct({
      buckets: Schema.Array(
        Schema.Struct({
          gap: Schema.Literals(CACHE_GAP_BUCKETS.map((bucket) => bucket.gap)),
          warmShare: Schema.Number,
          sample: Schema.Number,
        }),
      ),
      measuredBy: Schema.String,
      measuredAt: Schema.String,
    }),
  ),
  reasoningKeyed: Schema.optional(Schema.Boolean),
});

export const catalogStateSchema = Schema.Struct({
  readAt: Schema.NullOr(Schema.Number),
  failure: Schema.NullOr(Schema.String),
  warnings: Schema.Array(Schema.String),
});
export type CatalogState = typeof catalogStateSchema.Type;

export const catalogSnapshotSchema = Schema.Struct({
  models: Schema.Record(Schema.String, servedModelSchema),
  defaultTextModel: Schema.String,
  state: catalogStateSchema,
});
export type CatalogSnapshot = typeof catalogSnapshotSchema.Type;

export const servedProviderSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(['wire', 'harness']),
  auth: Schema.Literals(['api-key', 'oauth', 'cli']),
  keyScope: Schema.optional(Schema.Literals(['identity', 'workspace'])),
  icon: Schema.NullOr(Schema.String),
  accountsLabel: Schema.NullOr(Schema.String),
  signInMethods: Schema.Array(Schema.Literals(['loopback', 'device', 'paste', 'key', 'external-cli'])),
  keyHint: Schema.NullOr(Schema.String),
  quotaFromReplies: Schema.Boolean,
  dynamicCatalog: Schema.optional(Schema.Literal(true)),
  textless: Schema.optional(Schema.Literal(true)),
  catalogState: Schema.optional(catalogStateSchema),
  models: Schema.Record(Schema.String, servedModelSchema),
  imageModels: Schema.optional(Schema.Record(Schema.String, servedImageModelSchema)),
  cacheLifetime: cacheLifetimeSchema,
  requestLimits: Schema.optional(Schema.Struct({ bytes: Schema.Number, media: Schema.Number })),
  defaultTextModel: Schema.String,
  spawnTextModel: Schema.optional(Schema.String),
  lightTextModel: Schema.optional(
    Schema.Struct({
      model: Schema.String,
      rung: Schema.NullOr(Schema.String),
      switches: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
  family: Schema.optional(Schema.String),
  accountSource: Schema.String,
  instance: Schema.optional(Schema.Literal(true)),
  failure: Schema.optional(Schema.String),
  selectable: Schema.optional(Schema.Boolean),
});
export type ServedProvider = typeof servedProviderSchema.Type;

export const adapterOriginSchema = Schema.Literals(['builtin', 'release', 'machine']);
export type AdapterOrigin = typeof adapterOriginSchema.Type;

const adapterFields = {
  id: Schema.String,
  origin: adapterOriginSchema,
  version: Schema.NullOr(Schema.String),
  source: Schema.optional(Schema.String),
};

export const adapterStateSchema = Schema.Union([
  Schema.Struct({ ...adapterFields, state: Schema.Literal('loaded'), providers: Schema.Array(Schema.String) }),
  Schema.Struct({ ...adapterFields, state: Schema.Literal('failed'), reason: Schema.String }),
  Schema.Struct({ ...adapterFields, state: Schema.Literal('disabled') }),
]);
export type AdapterState = typeof adapterStateSchema.Type;

export const settingValuesSchema = Schema.Record(Schema.String, Schema.Unknown);
export type SettingValues = typeof settingValuesSchema.Type;

export const settingsDeclarationSchema = Schema.Struct({
  adapter: Schema.String,
  title: Schema.String,
  instance: Schema.String,
  name: Schema.String,
  fields: Schema.Array(settingFieldSchema),
  discovers: Schema.Boolean,
});
export type SettingsDeclaration = typeof settingsDeclarationSchema.Type;

export const servedInstanceSchema = Schema.Struct({
  id: Schema.String,
  values: settingValuesSchema,
  revision: Schema.optional(Schema.String),
});
export type ServedInstance = typeof servedInstanceSchema.Type;

export const servedSettingsSchema = Schema.Struct({ ...settingsDeclarationSchema.fields, instances: Schema.Array(servedInstanceSchema) });
export type ServedSettings = typeof servedSettingsSchema.Type;

export const accountSectionSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  selected: Schema.String,
  failure: Schema.optional(Schema.String),
  options: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      hint: Schema.String,
      provider: Schema.String,
      unavailable: Schema.NullOr(Schema.String),
      signInLabel: Schema.optional(Schema.String),
      defaultPlace: Schema.optional(Schema.String),
    }),
  ),
});
export type AccountSection = typeof accountSectionSchema.Type;

export const servedCatalogSchema = Schema.Struct({
  sections: Schema.Array(accountSectionSchema),
  providers: Schema.Array(servedProviderSchema),
  adapters: Schema.Array(adapterStateSchema),
  settings: Schema.Array(servedSettingsSchema),
});
export type ServedCatalog = typeof servedCatalogSchema.Type;

export const CATALOG_FEED = feed('catalog.subscribe', {
  input: Schema.Struct({}),
  event: servedCatalogSchema,
  refusals: [],
  callers: 'operator',
  graph: 'none',
});
