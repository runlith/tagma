import { describe, expect, test } from 'bun:test';
import { cacheGapBucket, cacheGapRange } from './cacheLifetime';

describe('cache gap buckets', () => {
  test('a pause lands in the bucket whose floor it reaches, floors inclusive and the last open-ended', () => {
    expect(cacheGapBucket(0)).toBe('<1m');
    expect(cacheGapBucket(59_999)).toBe('<1m');
    expect(cacheGapBucket(60_000)).toBe('1–5m');
    expect(cacheGapBucket(899_999)).toBe('5–15m');
    expect(cacheGapBucket(3_600_000)).toBe('1–2h');
    expect(cacheGapBucket(7_200_000)).toBe('>2h');
    expect(cacheGapBucket(30 * 24 * 3_600_000)).toBe('>2h');
  });

  test('a bucket`s range is the half-open span its neighbours bound, open at the end', () => {
    expect(cacheGapRange('1–5m')).toEqual({ fromMs: 60_000, toMs: 300_000 });
    expect(cacheGapRange('>2h')).toEqual({ fromMs: 7_200_000, toMs: null });
  });
});
