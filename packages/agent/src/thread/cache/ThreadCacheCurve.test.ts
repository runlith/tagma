import { expect, test } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { CACHE_CURVE_SAMPLE, type ThreadCacheObservationValues } from '../storage/cacheObservations';
import { makeInMemoryCacheObservations } from '../storage/InMemoryCacheObservationStorage';
import { ThreadCacheObservations } from '../ThreadPorts';
import { ThreadCacheCurve, cacheReadClass, threadCacheCurveLayer } from './ThreadCacheCurve';
const observed = (index: number, gapMs: number, cacheReadTokens: number): ThreadCacheObservationValues => ({
  runId: 'run-1',
  stepNumber: index,
  provider: 'openai-oauth',
  model: 'gpt-5.6-sol',
  sentAt: new Date(Date.UTC(2026, 8, 10, 10, 0, index)).toISOString(),
  gapMs,
  inputTokens: 100_000,
  cacheReadTokens,
});
const rows = Array.from({ length: CACHE_CURVE_SAMPLE + 1 }, (_, index) => observed(index, 2_000_000, index % 4 === 0 ? 0 : 95_000));
const storage = Layer.effect(
  ThreadCacheObservations,
  Effect.gen(function* () {
    const observations = yield* makeInMemoryCacheObservations;
    for (const row of rows.concat(
      observed(999, 30_000, 95_000),
      [95_000, 50_000, 0].map((read, index) => observed(index, 120_000, read)),
    )) {
      yield* observations.append('thread-1', row);
    }
    return observations;
  }),
);
layer(threadCacheCurveLayer.pipe(Layer.provide(storage)))('ThreadCacheCurve', (it) => {
  it.effect(
    'each provider and gap has its bounded sample; partial reads do not change the share',
    Effect.fnUntraced(function* () {
      const curve = yield* ThreadCacheCurve;
      const [reading, empty] = yield* curve.of(['openai-oauth', 'acme-oauth']);
      const bucket = reading!.buckets.find((entry) => entry.gap === '30–60m')!;
      expect(bucket.sample).toBe(CACHE_CURVE_SAMPLE);
      expect(bucket.oldestAt).toBe(rows[1]!.sentAt);
      expect(bucket.warmShare).toBe(0.75);
      expect(reading!.buckets.find((entry) => entry.gap === '<1m')).toEqual({
        gap: '<1m',
        sample: 1,
        warmShare: 1,
        oldestAt: expect.any(String),
      });
      expect(reading!.buckets.find((entry) => entry.gap === '>2h')).toEqual({ gap: '>2h', sample: 0, warmShare: null, oldestAt: null });
      expect(empty!.buckets.every((bucket) => bucket.sample === 0 && bucket.warmShare === null)).toBe(true);
      expect(reading!.buckets.find((entry) => entry.gap === '1–5m')).toMatchObject({ sample: 2, warmShare: 0.5 });
    }),
  );
  test('a read is warm at four fifths from cache, cold under a fifth, and partial between', () => {
    expect(cacheReadClass(100_000, 80_000)).toBe('warm');
    expect(cacheReadClass(100_000, 19_999)).toBe('cold');
    expect(cacheReadClass(100_000, 20_000)).toBe('partial');
    expect(cacheReadClass(0, 0)).toBe('cold');
  });
});
