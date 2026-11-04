import { AccountKey } from '@runlith/llm/models/authStatus';
import { Schema } from 'effect';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { accountProblemSchema } from './accounts.js';

export const DirectoryLogin = Schema.Struct({
  execution: ExecutionRef,
  projectId: Schema.Number,
  added: Schema.Boolean,
  cancelled: Schema.optional(Schema.Literal(true)),
});
export type DirectoryLogin = typeof DirectoryLogin.Type;

export const DirectoryAccount = Schema.Struct({
  key: AccountKey,
  label: Schema.String,
  machine: Schema.String,
  directory: Schema.NullOr(Schema.String),
  addedAt: Schema.Number,
  signed: Schema.Boolean,
  pending: Schema.Boolean,
  requested: Schema.optional(Schema.Literal(true)),
  failed: Schema.optional(Schema.Boolean),
  login: Schema.optional(DirectoryLogin),
  problem: Schema.optional(Schema.NullOr(accountProblemSchema)),
  observed: Schema.optional(Schema.Literal(true)),
  made: Schema.optional(Schema.Literal(true)),
});
export type DirectoryAccount = typeof DirectoryAccount.Type;

export const requestedAccount = (row: DirectoryAccount): boolean =>
  row.requested === true || (row.observed !== true && row.directory !== null);
