export const CACHE_GAP_BUCKETS = [
  { gap: '<1m', floorSeconds: 0 },
  { gap: '1–5m', floorSeconds: 60 },
  { gap: '5–15m', floorSeconds: 300 },
  { gap: '15–30m', floorSeconds: 900 },
  { gap: '30–60m', floorSeconds: 1_800 },
  { gap: '1–2h', floorSeconds: 3_600 },
  { gap: '>2h', floorSeconds: 7_200 },
] as const;

export type CacheGapBucket = (typeof CACHE_GAP_BUCKETS)[number]['gap'];

export function cacheGapBucket(gapMs: number): CacheGapBucket {
  const seconds = gapMs / 1_000;
  for (let index = CACHE_GAP_BUCKETS.length - 1; index > 0; index -= 1) {
    const bucket = CACHE_GAP_BUCKETS[index]!;
    if (seconds >= bucket.floorSeconds) return bucket.gap;
  }
  return CACHE_GAP_BUCKETS[0].gap;
}

export function cacheGapRange(bucket: CacheGapBucket): { readonly fromMs: number; readonly toMs: number | null } {
  const index = CACHE_GAP_BUCKETS.findIndex((entry) => entry.gap === bucket);
  const next = CACHE_GAP_BUCKETS[index + 1];
  return { fromMs: CACHE_GAP_BUCKETS[index]!.floorSeconds * 1_000, toMs: next ? next.floorSeconds * 1_000 : null };
}

export type CacheCurveBucket = {
  readonly gap: CacheGapBucket;
  readonly warmShare: number;
  readonly sample: number;
};

export type CacheCurve = {
  readonly buckets: readonly CacheCurveBucket[];
  readonly measuredBy: string;
  readonly measuredAt: string;
};

export type ModelCacheLifetime = {
  readonly promisedSeconds: number | null;
  readonly prior: CacheCurve | null;
  readonly reasoningKeyed?: boolean;
};
