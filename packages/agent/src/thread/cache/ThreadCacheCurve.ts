import { Context, Effect, Layer } from 'effect';
import { CACHE_GAP_BUCKETS, type CacheGapBucket, cacheGapBucket } from '@runlith/llm/models/cacheLifetime';
import { CACHE_CURVE_SAMPLE, type ThreadCacheObservation } from '../storage/cacheObservations';
import type { ThreadPortFailure } from '../ThreadBorder';
import { ThreadCacheObservations } from '../ThreadPorts';

export const CACHE_WARM_SHARE = 0.8;
export const CACHE_COLD_SHARE = 0.2;

export type ThreadCacheReadClass = 'warm' | 'cold' | 'partial';

export function cacheReadClass(inputTokens: number, cacheReadTokens: number): ThreadCacheReadClass {
  const share = inputTokens > 0 ? cacheReadTokens / inputTokens : 0;
  return share >= CACHE_WARM_SHARE ? 'warm' : share < CACHE_COLD_SHARE ? 'cold' : 'partial';
}

export type ThreadCacheCurveBucket = {
  readonly gap: CacheGapBucket;
  readonly sample: number;
  readonly warmShare: number | null;
  readonly oldestAt: string | null;
};

export type ThreadCacheCurveReading = {
  readonly provider: string;
  readonly buckets: readonly ThreadCacheCurveBucket[];
};

export function cacheCurveBucket(gap: CacheGapBucket, rows: readonly ThreadCacheObservation[]): ThreadCacheCurveBucket {
  let warm = 0;
  let cold = 0;
  for (const row of rows) {
    const read = cacheReadClass(row.inputTokens, row.cacheReadTokens);
    if (read === 'warm') warm += 1;
    else if (read === 'cold') cold += 1;
  }
  const sample = warm + cold;
  return { gap, sample, warmShare: sample === 0 ? null : warm / sample, oldestAt: rows.at(-1)?.sentAt ?? null };
}

export function cacheCurves(providers: readonly string[], rows: readonly ThreadCacheObservation[]): readonly ThreadCacheCurveReading[] {
  const held = new Map<string, Map<CacheGapBucket, ThreadCacheObservation[]>>();
  for (const row of rows) {
    const buckets = held.get(row.provider) ?? new Map<CacheGapBucket, ThreadCacheObservation[]>();
    held.set(row.provider, buckets);
    const gap = cacheGapBucket(row.gapMs);
    const kept = buckets.get(gap) ?? [];
    buckets.set(gap, kept);
    kept.push(row);
  }
  return providers.map((provider) => ({
    provider,
    buckets: CACHE_GAP_BUCKETS.map((bucket) => cacheCurveBucket(bucket.gap, held.get(provider)?.get(bucket.gap) ?? [])),
  }));
}

export class ThreadCacheCurve extends Context.Service<
  ThreadCacheCurve,
  { of(providers: readonly string[]): Effect.Effect<readonly ThreadCacheCurveReading[], ThreadPortFailure> }
>()('@runlith/agent/ThreadCacheCurve') {}

export const threadCacheCurveLayer: Layer.Layer<ThreadCacheCurve, never, ThreadCacheObservations> = Layer.effect(
  ThreadCacheCurve,
  Effect.map(ThreadCacheObservations, (observations) => ({
    of: (providers) =>
      providers.length === 0
        ? Effect.succeed([])
        : Effect.map(observations.latest(providers, CACHE_CURVE_SAMPLE), (rows) => cacheCurves(providers, rows)),
  })),
);
