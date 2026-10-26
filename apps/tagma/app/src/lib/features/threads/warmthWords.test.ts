import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { expect, test } from 'vitest';
import { warmthAt, warmthFilled } from './warmthWords.js';

const NOW = Date.UTC(2026, 8, 10, 10, 13, 0);

const promised = (expiresAt: string): ThreadCacheWarmth => ({
  state: 'warm',
  heldTokens: 480_000,
  basis: 'promise',
  expiresAt,
  gap: null,
  warmShare: null,
  sample: null,
  oldestAt: null,
  invalidatedBy: null,
});

test('a promised window is warm and filled until it passes, then cold and hollow, without a new row', () => {
  const warmth = promised(new Date(NOW + 47 * 60_000).toISOString());
  expect(warmthAt(warmth, () => NOW)).toBe('warm');
  expect(warmthFilled(warmth, () => NOW)).toBe(true);

  const later = NOW + 67 * 60_000;
  expect(warmthAt(warmth, () => later)).toBe('cold');
  expect(warmthFilled(warmth, () => later)).toBe(false);
});

test('a curve verdict stands as projected: likely fills, cold, unknown and no warmth at all stand hollow', () => {
  const likely: ThreadCacheWarmth = {
    ...promised(''),
    state: 'likely',
    basis: 'local',
    expiresAt: null,
    gap: '30–60m',
    warmShare: 0.74,
    sample: 23,
  };
  expect(warmthFilled(likely, () => NOW)).toBe(true);
  expect(warmthFilled({ ...likely, state: 'cold', warmShare: 0.2, basis: 'prior' }, () => NOW)).toBe(false);
  expect(warmthFilled({ ...likely, state: 'unknown', basis: 'none', warmShare: null, sample: null }, () => NOW)).toBe(false);
  expect(warmthFilled(null, () => NOW)).toBe(false);
});
