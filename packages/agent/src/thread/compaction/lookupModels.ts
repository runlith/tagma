import type { ModelCacheLifetime } from '@runlith/llm/models/cacheLifetime';
import type { ModelCapacity, ModelCompactionTrigger, ProviderRequestLimits } from '@runlith/llm/models/description';
import { Effect } from 'effect';
import type { CompactionModels } from './CompactionModels';

type Lookup<A> = (provider: string, model: string | null | undefined) => A;

export type ModelLookups = {
  readonly request: CompactionModels['request'];
  readonly capacity: Lookup<ModelCapacity>;
  readonly cacheLifetime?: Lookup<ModelCacheLifetime>;
  readonly requestLimits?: Lookup<ProviderRequestLimits | undefined>;
  readonly compactionTrigger?: Lookup<ModelCompactionTrigger | undefined>;
  readonly modelId?: Lookup<string>;
};

export const lookupModels = (lookups: ModelLookups): CompactionModels => ({
  request: (input) => lookups.request(input),
  served: (provider, model) =>
    Effect.sync(() => ({
      id: model ?? lookups.modelId?.(provider, null) ?? provider,
      capacity: lookups.capacity(provider, model),
      cacheLifetime: lookups.cacheLifetime?.(provider, model) ?? { promisedSeconds: null, prior: null },
      requestLimits: lookups.requestLimits?.(provider, model),
      compactionTrigger: lookups.compactionTrigger?.(provider, model),
    })),
  defaultModel: (provider) => lookups.modelId?.(provider, null) ?? null,
});
