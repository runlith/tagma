import { Effect } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import {
  CACHE_CURVE_SAMPLE,
  type ThreadCacheObservation,
  type ThreadCacheObservationValues,
} from '@runlith/agent/thread/storage/cacheObservations';
import { CACHE_GAP_BUCKETS, type CacheGapBucket, cacheGapBucket, cacheGapRange } from '@runlith/llm/models/cacheLifetime';
import { and, desc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/sqlite-core';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { type Unit, MachineUnits } from '../../platform/contract/service/units.js';
import { threadCacheObservation } from '../store/thread.js';
import { stored } from '../../platform/store/crossing.js';

function capped(rows: readonly ThreadCacheObservation[], limit: number): readonly ThreadCacheObservation[] {
  const taken = new Map<string, number>();
  const kept: ThreadCacheObservation[] = [];
  for (const row of rows) {
    const key = `${row.provider}\u0000${cacheGapBucket(row.gapMs)}`;
    const count = taken.get(key) ?? 0;
    if (count >= limit) continue;
    taken.set(key, count + 1);
    kept.push(row);
  }
  return kept;
}

const inBucket = (provider: string, bucket: CacheGapBucket): SQL => {
  const range = cacheGapRange(bucket);
  return and(
    eq(threadCacheObservation.provider, provider),
    gte(threadCacheObservation.gapMs, range.fromMs),
    ...(range.toMs === null ? [] : [lt(threadCacheObservation.gapMs, range.toMs)]),
  )!;
};

export type ThreadCacheObservationStore = Effect.Success<typeof makeCacheObservationStore>;

export const makeCacheObservationStore = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const newestPerBucket = (providers: readonly string[], limit: number) => {
    const [first, second, ...rest] = providers.flatMap((provider) =>
      CACHE_GAP_BUCKETS.map((bucket) =>
        db
          .select()
          .from(
            db
              .select()
              .from(threadCacheObservation)
              .where(inBucket(provider, bucket.gap))
              .orderBy(desc(threadCacheObservation.id))
              .limit(limit)
              .as('bucket'),
          ),
      ),
    );
    return unionAll(first!, second!, ...rest).orderBy(desc(threadCacheObservation.id));
  };

  return {
    append: Effect.fnUntraced(function* (threadId: string, values: ThreadCacheObservationValues, tx: Unit<'machine'>) {
      yield* tx.run(
        db
          .insert(threadCacheObservation)
          .values({ ...values, threadId })
          .run(),
      );
      const kept = yield* tx.run(
        db
          .select({ id: threadCacheObservation.id })
          .from(threadCacheObservation)
          .where(inBucket(values.provider, cacheGapBucket(values.gapMs)))
          .orderBy(desc(threadCacheObservation.id))
          .limit(1)
          .offset(CACHE_CURVE_SAMPLE)
          .get(),
      );
      if (!kept) return;
      yield* tx.run(
        db
          .delete(threadCacheObservation)
          .where(and(inBucket(values.provider, cacheGapBucket(values.gapMs)), lt(threadCacheObservation.id, kept.id + 1)))
          .run(),
      );
    }, stored('append')),
    latest: (
      providers: readonly string[],
      limit: number,
      tx?: Unit<'machine'>,
    ): Effect.Effect<readonly ThreadCacheObservation[], ThreadStorageFailed> => {
      const wanted = [...new Set(providers)];
      if (wanted.length === 0) return Effect.succeed([]);
      const bound = wanted.length * CACHE_GAP_BUCKETS.length * limit + 1;
      const read = (unit: Unit<'machine'>) =>
        Effect.flatMap(
          unit.run(
            db
              .select()
              .from(threadCacheObservation)
              .where(inArray(threadCacheObservation.provider, wanted))
              .orderBy(desc(threadCacheObservation.id))
              .limit(bound)
              .all(),
          ),
          (rows): Effect.Effect<readonly ThreadCacheObservation[], StoreFailure> =>
            rows.length < bound ? Effect.succeed(capped(rows, limit)) : unit.run(newestPerBucket(wanted, limit)),
        );
      return stored('latest')(tx ? read(tx) : units.read(read));
    },
  };
});
