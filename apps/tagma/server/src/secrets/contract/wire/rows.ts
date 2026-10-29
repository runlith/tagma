import { Schema } from 'effect';

export const SECRET_VALUE_MAX = 16_384;

export const secretOwnerSchema = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u), Schema.isMaxLength(32)).annotate({
  description: 'The kind of owner the secret belongs to, as read_secrets names it.',
});

export const secretOwnerIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({
  description: 'Which owner of that kind, as read_secrets names it.',
});

export const secretNameSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)).annotate({
  description: 'The secret, as its owner declares it.',
});

export const secretRowSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  set: Schema.Boolean.annotate({ description: 'Whether the operator has given it a value; the value itself is never read back.' }),
});
export type SecretRow = typeof secretRowSchema.Type;

export const secretSetSchema = Schema.Struct({
  owner: Schema.String,
  id: Schema.String,
  title: Schema.String,
  secrets: Schema.Array(secretRowSchema),
  missing: Schema.Int.annotate({ description: 'How many of its declared secrets have no value yet.' }),
});
export type SecretSet = typeof secretSetSchema.Type;

export const SECRET_READ_REFUSALS = ['unknown-project', 'secret-owner-unknown', 'secret-owner-failed', 'secret-store-failed'] as const;
export type SecretReadRefusal = (typeof SECRET_READ_REFUSALS)[number];

export const SECRET_REMOVE_REFUSALS = [...SECRET_READ_REFUSALS, 'secret-unknown', 'secret-store-unavailable'] as const;
export type SecretRemoveRefusal = (typeof SECRET_REMOVE_REFUSALS)[number];

export const SECRET_CHANGE_REFUSALS = [...SECRET_REMOVE_REFUSALS, 'secret-value-invalid'] as const;
export type SecretChangeRefusal = (typeof SECRET_CHANGE_REFUSALS)[number];
