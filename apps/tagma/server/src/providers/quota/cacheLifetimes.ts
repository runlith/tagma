import { CACHE_CURVE_FLOOR } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { CACHE_GAP_BUCKETS, type ModelCacheLifetime } from '@runlith/llm/models/cacheLifetime';
import type { CacheCurveReading } from '../contract/service/quota.js';
import type { ProviderCatalog } from '../contract/service/registry.js';
import type { ProviderCacheLifetime } from '../contract/wire/accounts.js';

const providerCacheLifetime = (provider: string, lifetime: ModelCacheLifetime, local: CacheCurveReading | null): ProviderCacheLifetime => ({
  provider,
  promisedSeconds: lifetime.promisedSeconds,
  buckets: CACHE_GAP_BUCKETS.map(({ gap }) => {
    const own = local?.buckets.find((bucket) => bucket.gap === gap);
    if (own !== undefined && own.warmShare !== null && own.sample >= CACHE_CURVE_FLOOR) {
      return { gap, warmShare: own.warmShare, sample: own.sample, source: 'local' as const };
    }
    const prior = lifetime.prior?.buckets.find((bucket) => bucket.gap === gap);
    if (prior !== undefined) return { gap, warmShare: prior.warmShare, sample: prior.sample, source: 'prior' as const };
    return { gap, warmShare: null, sample: own?.sample ?? 0, source: null };
  }),
  priorMeasuredAt: lifetime.prior?.measuredAt ?? null,
});

export const cacheLifetimes = (
  catalog: ProviderCatalog,
  curves: ReadonlyMap<string, CacheCurveReading>,
): readonly ProviderCacheLifetime[] =>
  catalog.wires.providers.flatMap((provider) =>
    provider.auth === 'oauth' ? [providerCacheLifetime(provider.id, provider.cacheLifetime, curves.get(provider.id) ?? null)] : [],
  );
