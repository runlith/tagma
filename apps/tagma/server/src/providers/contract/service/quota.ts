import type { CacheGapBucket } from '@runlith/llm/models/cacheLifetime';
import type { ThreadSummarizerSkipReason } from '@runlith/agent/transcript/entries';
import type { AccountKey } from '@runlith/llm/models/authStatus';
import type { QuotaObservation, QuotaFailure } from '@runlith/llm/schema/quota';
import { Context, type Effect, type Stream } from 'effect';
import type { QuotaTable } from '../wire/accounts.js';

export type CacheCurveReading = {
  readonly buckets: readonly { readonly gap: CacheGapBucket; readonly warmShare: number | null; readonly sample: number }[];
};

export class CacheCurves extends Context.Service<CacheCurves, { readings(): Effect.Effect<ReadonlyMap<string, CacheCurveReading>> }>()(
  'tagma/providers/CacheCurves',
) {}

export class AccountQuota extends Context.Service<
  AccountQuota,
  {
    table(): Effect.Effect<QuotaTable>;
    observe(provider: string, account: AccountKey, observation: QuotaObservation): Effect.Effect<void>;
    merge(provider: string, account: AccountKey, observation: QuotaObservation): Effect.Effect<void>;
    fail(provider: string, account: AccountKey, failure: QuotaFailure): Effect.Effect<void>;
    refresh(provider?: string, account?: AccountKey): Effect.Effect<void>;
    readonly changes: Stream.Stream<QuotaTable>;
  }
>()('tagma/providers/AccountQuota') {}

export type Spendability =
  | { readonly spendable: true; readonly account: string }
  | {
      readonly spendable: false;
      readonly reason: Exclude<ThreadSummarizerSkipReason, 'unavailable' | 'overflow'>;
      readonly until?: number;
    };
