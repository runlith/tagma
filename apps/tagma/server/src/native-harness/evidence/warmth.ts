import { Effect } from 'effect';
import { cacheCurves } from '@runlith/agent/thread/cache/ThreadCacheCurve';
import { CACHE_CURVE_SAMPLE } from '@runlith/agent/thread/storage/cacheObservations';
import { AccountCredentials } from '../../providers/contract/service/access.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { CacheWarmth } from '../../threads/contract/service/evidence.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { WarmthBasis } from '../../threads/contract/wire/warmth.js';
import { warmthProviders } from '../../threads/list/warmth.js';
import type { ThreadCacheObservationStore } from '../models/cacheObservations.js';

export const cacheWarmth = Effect.fnUntraced(function* (observations: ThreadCacheObservationStore) {
  const credentials = yield* AccountCredentials;
  const registry = yield* ProviderRegistry;

  const curvesOf = (providers: readonly string[]): Effect.Effect<WarmthBasis['curves'], HarnessFailure> =>
    Effect.map(
      observations.latest(providers, CACHE_CURVE_SAMPLE),
      (rows) => new Map(cacheCurves(providers, rows).map((reading) => [reading.provider, reading])),
    );

  const accountsOf = (providers: readonly string[]): Effect.Effect<WarmthBasis['accounts']> =>
    Effect.map(
      Effect.forEach(
        providers,
        (provider) =>
          credentials.account(provider).pipe(
            Effect.map((account) => [[provider, String(account)] as const]),
            Effect.catch(() => Effect.succeed([])),
          ),
        { concurrency: 'unbounded' },
      ),
      (pairs) => new Map(pairs.flat()),
    );

  return CacheWarmth.of({
    cacheCurves: () => Effect.flatMap(registry.catalog, ({ models }) => curvesOf(models.providerOptions.map((provider) => provider.id))),
    warmthBasis: (subjects) =>
      Effect.flatMap(registry.catalog, ({ models }) => {
        const providers = warmthProviders(subjects);
        return providers.length === 0
          ? Effect.succeed({ curves: new Map(), accounts: new Map(), models })
          : Effect.all({ curves: curvesOf(providers), accounts: accountsOf(providers), models: Effect.succeed(models) });
      }),
  });
});
