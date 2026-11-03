import { AccountKey, CredentialOrigin } from '@runlith/llm/models/authStatus';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { Schema } from 'effect';

export const accountStatusSchema = Schema.Struct({
  account: AccountKey,
  provider: Schema.String,
  label: Schema.String,
  organization: Schema.optional(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  origin: CredentialOrigin,
  addedAt: Schema.Number,
  default: Schema.Boolean,
  pending: Schema.optional(Schema.Boolean),
  failed: Schema.optional(Schema.Boolean),
});
export type AccountStatus = typeof accountStatusSchema.Type;

export const signInStatusSchema = Schema.Record(Schema.String, Schema.Array(accountStatusSchema));
export type SignInStatus = typeof signInStatusSchema.Type;

export const signInBeginSchema = Schema.Union([
  Schema.Struct({ flow: Schema.Literal('loopback'), authorizeUrl: Schema.String }),
  Schema.Struct({ flow: Schema.Literal('device'), authorizeUrl: Schema.String, userCode: Schema.String }),
  Schema.Struct({ flow: Schema.Literal('paste'), authorizeUrl: Schema.String }),
  Schema.Struct({ flow: Schema.Literal('key') }),
  Schema.Struct({ flow: Schema.Literal('adopted'), provider: Schema.String, account: AccountKey, label: Schema.String }),
  Schema.Struct({ flow: Schema.Literal('external-cli'), provider: Schema.String, account: AccountKey, execution: ExecutionRef }),
]);
export type SignInBegun = typeof signInBeginSchema.Type;

export const signInPendingSchema = Schema.Struct({ pending: Schema.Literal(true), message: Schema.String });
export const signInCompleteSchema = Schema.Union([accountStatusSchema, signInPendingSchema]);
export type SignInCompleted = typeof signInCompleteSchema.Type;

export const accountRemovedSchema = Schema.Struct({
  provider: Schema.String,
  removed: AccountKey,
  default: Schema.NullOr(AccountKey),
});
export type AccountRemoved = typeof accountRemovedSchema.Type;

export const consoleKeySavedSchema = Schema.Struct({
  provider: Schema.String,
  account: Schema.String,
  updatedAt: Schema.Number,
});
export type ConsoleKeySaved = typeof consoleKeySavedSchema.Type;

export const consoleKeyRemovedSchema = Schema.Struct({ provider: Schema.String, account: Schema.String });
export type ConsoleKeyRemoved = typeof consoleKeyRemovedSchema.Type;

export const consoleKeysSchema = Schema.Array(
  Schema.Struct({
    provider: Schema.String,
    keys: Schema.Array(Schema.Struct({ account: Schema.String, label: Schema.String, default: Schema.Boolean })),
  }),
);
export type ConsoleKeys = typeof consoleKeysSchema.Type;
