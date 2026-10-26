import { Schema } from 'effect';
import { SecretName } from './entries.js';

export const secretRowSchema = Schema.Struct({
  name: SecretName,
  description: Schema.String,
  set: Schema.Boolean.annotate({ description: 'Whether the operator has given it a value; the value itself is never read back.' }),
});
export type SecretRow = typeof secretRowSchema.Type;

export const pluginSecretSetSchema = Schema.Struct({
  plugin: Schema.String,
  title: Schema.String,
  secrets: Schema.Array(secretRowSchema),
  missing: Schema.Int.annotate({ description: 'How many of its declared secrets have no value yet.' }),
});
export type PluginSecretSet = typeof pluginSecretSetSchema.Type;

export const SECRET_READ_REFUSALS = ['not-found', 'plugin-floor-unreadable', 'unknown-project', 'secret-store-failed'] as const;
export type SecretReadRefusal = (typeof SECRET_READ_REFUSALS)[number];

export const SECRET_REMOVE_REFUSALS = [...SECRET_READ_REFUSALS, 'plugin-secret-unknown', 'secret-store-unavailable'] as const;
export type SecretRemoveRefusal = (typeof SECRET_REMOVE_REFUSALS)[number];

export const SECRET_CHANGE_REFUSALS = [...SECRET_REMOVE_REFUSALS, 'secret-value-invalid'] as const;
export type SecretChangeRefusal = (typeof SECRET_CHANGE_REFUSALS)[number];
