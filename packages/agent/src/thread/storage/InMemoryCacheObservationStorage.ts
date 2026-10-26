import { Effect } from 'effect';
import type { ThreadPortFailure } from '../ThreadBorder';
import { type CacheGapBucket, cacheGapBucket } from '@runlith/llm/models/cacheLifetime';
import {
  CACHE_CURVE_SAMPLE,
  type ThreadCacheObservation,
  type ThreadCacheObservationStorage,
  type ThreadCacheObservationValues,
} from './cacheObservations';

type MemoryCacheObservations = ThreadCacheObservationStorage<undefined> & { readonly rows: ThreadCacheObservation[] };

export const makeInMemoryCacheObservations = Effect.gen(function* () {
  const rows: ThreadCacheObservation[] = [];

  const append = (threadId: string, values: ThreadCacheObservationValues): Effect.Effect<void, ThreadPortFailure> => {
    return Effect.sync(() => {
      rows.push({ ...values, threadId });
      const bucket = cacheGapBucket(values.gapMs);
      const inSample = inBucket(values.provider, bucket);
      const kept = new Set(inSample.slice(-CACHE_CURVE_SAMPLE));
      const dropped = new Set(inSample.filter((row) => !kept.has(row)));
      if (dropped.size > 0) rows.splice(0, rows.length, ...rows.filter((row) => !dropped.has(row)));
    });
  };

  const latest = (providers: readonly string[], limit: number): Effect.Effect<readonly ThreadCacheObservation[], ThreadPortFailure> =>
    Effect.sync(() => latestNow(providers, limit));

  const latestNow = (providers: readonly string[], limit: number): readonly ThreadCacheObservation[] => {
    const wanted = new Set(providers);
    const taken = new Map<string, number>();
    const kept: ThreadCacheObservation[] = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]!;
      if (!wanted.has(row.provider)) continue;
      const key = `${row.provider}\u0000${cacheGapBucket(row.gapMs)}`;
      const count = taken.get(key) ?? 0;
      if (count >= limit) continue;
      taken.set(key, count + 1);
      kept.push(row);
    }
    return kept;
  };

  const inBucket = (provider: string, bucket: CacheGapBucket): ThreadCacheObservation[] =>
    rows.filter((row) => row.provider === provider && cacheGapBucket(row.gapMs) === bucket);

  return { rows, append, latest } satisfies MemoryCacheObservations;
});
