import { expect, test } from 'vitest';
import { calibrate, momentum } from './momentum.fixture';
import type { ScrollRecording } from '@runlith/e2e/ios';

const fling = (offsets: readonly number[], velocity = 1, times = offsets.map((_, index) => (index + 1) * 10)): ScrollRecording => ({
  frames: offsets.map((offset, index) => ({ t: times[index]!, offset })),
  touches: [{ type: 'touchend', t: 0, offset: 0, x: 0, y: 0, trusted: true }],
  scrolls: [],
  release: { t: 0, offset: 0, velocity, touchVelocity: null, velocitySource: 'first-momentum-frames' },
});

test('a fling passes decay, out-of-phase samples, a stalled page and a fold at rest, and fails pull-back, a stop, a moving write and a short distance', () => {
  const control = calibrate(Array.from({ length: 5 }, (_, index) => fling([10, 20, 25, 27, 28, 28], 1 + index / 100)));
  expect(momentum(fling([10, 20, 25, 27, 28, 28], 1.02), control)).toEqual({
    ratio: 28 / 1.02,
    floor: 14 / 1.04,
    reversals: 0,
    interruptions: 0,
    unjudged: 0,
    stoppingWrites: 0,
    aboveFloor: true,
  });
  const stalled = fling([10, 20, 28, 34, 40, 41, 41, 41, 42, 49, 49, 49], 1, [10, 20, 30, 40, 50, 60, 70, 520, 540, 545, 555, 565]);
  expect(momentum(stalled, control)).toMatchObject({ interruptions: 0, unjudged: 5 });
  expect(momentum(fling([10, 30, 30, 37, 39, 40, 40, 41, 41, 41]), control).interruptions).toBe(0);
  expect(momentum(fling([10, 20, 18, 25, 26, 26]), control).reversals).toBe(1);
  expect(momentum(fling([10, 20, 20, 20, 20]), control).interruptions).toBe(1);
  const caughtUp = fling([10, 20, 30, 40, 70, 70, 70, 80, 90], 1, [10, 20, 30, 40, 70, 72, 80, 90, 100]);
  expect(momentum(caughtUp, control).interruptions).toBe(0);
  const folded = momentum(fling([10, 20, 25, 27, 28, 28, 28, 60]), control, [{ time: 75, from: 28, to: 60 }]);
  expect([folded.stoppingWrites, folded.reversals, folded.aboveFloor]).toEqual([0, 0, true]);
  expect(momentum(fling([10, 20, 25, 25, 25]), control, [{ time: 25, from: 25, to: 24 }]).stoppingWrites).toBe(1);
  expect(momentum(fling([10, 20, 25, 27, 28, 28]), control, [{ time: 25, from: 25, to: 25 }]).stoppingWrites).toBe(0);
  expect(momentum(fling([5, 8, 8, 8]), control).aboveFloor).toBe(false);
});
