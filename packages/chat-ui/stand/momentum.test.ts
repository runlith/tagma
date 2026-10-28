import { expect, test } from 'bun:test';
import { calibrate, momentum } from './momentum.fixture';
import type { ScrollRecording } from '@runlith/e2e/ios';

const fling = (offsets: readonly number[], velocity = 1): ScrollRecording => ({
  frames: offsets.map((offset, index) => ({ t: (index + 1) * 10, offset })),
  touches: [{ type: 'touchend', t: 0, offset: 0, x: 0, y: 0, trusted: true }],
  scrolls: [],
  release: { t: 0, offset: 0, velocity, touchVelocity: null, velocitySource: 'first-momentum-frames' },
});

test('a normalized fling accepts control decay and rejects pull-back or an early stop', () => {
  const control = calibrate(Array.from({ length: 5 }, (_, index) => fling([10, 20, 25, 27, 28, 28], 1 + index / 100)));
  expect(momentum(fling([10, 20, 25, 27, 28, 28], 1.02), control)).toEqual({
    ratio: 28 / 1.02,
    minRatio: 28 / 1.04,
    maxRatio: 28,
    reversals: 0,
    interruptions: 0,
    withinSpread: true,
  });
  const pulled = momentum(fling([10, 20, 18, 25, 26, 26]), control);
  expect(pulled.reversals).toBe(1);
  expect(pulled.interruptions).toBe(1);
  const stopped = momentum(fling([10, 20, 20, 20, 20]), control);
  expect(stopped.interruptions).toBe(1);
  expect(stopped.withinSpread).toBe(false);
});
