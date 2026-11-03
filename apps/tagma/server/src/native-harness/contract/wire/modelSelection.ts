import { Schema } from 'effect';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ModelPreference } from '../../../threads/contract/wire/birth.js';

export type ModelDefaultsWrite = Omit<ModelPreference, 'switches'> & {
  readonly switches?: ModelSwitches;
};

export type RememberedSwitches = Readonly<Record<string, Readonly<Record<string, ModelSwitches>>>>;

export type ModelDefaults =
  | { readonly status: 'read'; readonly defaults: ModelPreference; readonly remembered: RememberedSwitches }
  | { readonly status: 'unconnected'; readonly plans: readonly string[] };

export const modelConnectionSchema = Schema.Struct({
  state: Schema.Literals(['discovering', 'connected', 'unconnected']),
  plans: Schema.Array(Schema.String),
});
export type ModelConnection = typeof modelConnectionSchema.Type;

export type ThreadModelSettings = Omit<ModelPreference, 'account'> & {
  readonly account?: string | null;
};

export const modelDefaultsSchema = Schema.Struct({
  account: Schema.NullOr(Schema.String),
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoning: Schema.NullOr(Schema.String),
  switches: Schema.Record(Schema.String, Schema.String),
});

export const rememberedSwitchesSchema = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
);

export const modelDefaultsWriteSchema = Schema.Struct({
  ...modelDefaultsSchema.fields,
  switches: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export const favoriteModelsSchema = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      provider: Schema.String.check(Schema.isMinLength(1)),
      model: Schema.String.check(Schema.isMinLength(1)),
    }),
  ),
});
export type FavoriteModels = typeof favoriteModelsSchema.Type;
