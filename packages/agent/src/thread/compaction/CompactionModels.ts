import type { ModelCacheLifetime } from '@runlith/llm/models/cacheLifetime';
import type { ModelCapacity, ModelCompactionTrigger, ProviderRequestLimits } from '@runlith/llm/models/description';
import { Data, type Effect } from 'effect';
import type { ModelRequest, ModelRequestInput } from '../../agent/modelPort';

export class ThreadModelNotServed extends Data.TaggedError('ThreadModelNotServed')<{
  readonly provider: string;
  readonly model: string | null;
}> {
  override get message(): string {
    return this.model === null
      ? `No installed adapter serves ${this.provider}.`
      : `No installed adapter serves ${this.provider} model ${this.model}.`;
  }
}

export type ServedModel = {
  readonly id: string;
  readonly capacity: ModelCapacity;
  readonly cacheLifetime: ModelCacheLifetime;
  readonly requestLimits: ProviderRequestLimits | undefined;
  readonly compactionTrigger: ModelCompactionTrigger | undefined;
};

export interface CompactionModels {
  request(input: ModelRequestInput): ModelRequest;

  served(provider: string, model: string | null | undefined, runId?: string): Effect.Effect<ServedModel, ThreadModelNotServed>;

  defaultModel(provider: string, runId?: string): string | null;
}
