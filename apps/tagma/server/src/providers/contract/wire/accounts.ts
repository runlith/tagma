import { AccountKey, CredentialOrigin } from '@runlith/llm/models/authStatus';
import { feed } from '../../../platform/contract/wire/operation.js';
import { CACHE_GAP_BUCKETS } from '@runlith/llm/models/cacheLifetime';
import { QuotaFailure, QuotaObservation } from '@runlith/llm/schema/quota';
import { Schema } from 'effect';

export const consoleKeyLabel = (account: string): string => `Key ${account}`;

export const providerCacheLifetimeSchema = Schema.Struct({
  provider: Schema.String,
  promisedSeconds: Schema.NullOr(Schema.Number),
  buckets: Schema.Array(
    Schema.Struct({
      gap: Schema.Literals(CACHE_GAP_BUCKETS.map((bucket) => bucket.gap)),
      warmShare: Schema.NullOr(Schema.Number),
      sample: Schema.Number,
      source: Schema.NullOr(Schema.Literals(['local', 'prior'])),
    }),
  ),
  priorMeasuredAt: Schema.NullOr(Schema.String),
});
export type ProviderCacheLifetime = typeof providerCacheLifetimeSchema.Type;
export const cacheLifetimesSchema = Schema.Array(providerCacheLifetimeSchema);

export const accountProblemSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unreadable'), reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('not-installed') }),
  Schema.Struct({ kind: Schema.Literal('signed-out') }),
  Schema.Struct({ kind: Schema.Literal('unsupported-method'), method: Schema.String }),
]);
export type AccountProblem = typeof accountProblemSchema.Type;

export const accountQuotaRowSchema = Schema.Struct({
  provider: Schema.String,
  account: AccountKey,
  label: Schema.String,
  origin: CredentialOrigin,
  problem: Schema.NullOr(accountProblemSchema),
  default: Schema.Boolean,
  expiresAt: Schema.optional(Schema.Number),
  quota: Schema.NullOr(QuotaObservation),
  restored: Schema.Boolean,
  failure: Schema.NullOr(QuotaFailure),
  failedAt: Schema.NullOr(Schema.Number),
});

export type AccountQuotaRow = typeof accountQuotaRowSchema.Type;
export const accountsFrameSchema = Schema.Array(accountQuotaRowSchema);
export type QuotaTable = typeof accountsFrameSchema.Type;

export const ACCOUNTS_FEED = feed('accounts.subscribe', {
  input: Schema.Struct({}),
  event: accountsFrameSchema,
  refusals: [],
  callers: 'operator',
  graph: 'none',
});
