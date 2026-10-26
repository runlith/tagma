import { expect, test } from 'bun:test';
import { scaleOf } from './units.js';

test('an interval climbs to the largest unit it fills: a ten-minute bound is not six hundred seconds', () => {
  expect(scaleOf('milliseconds', 600_000)).toEqual({ shown: 10, unit: 'min' });
  expect(scaleOf('milliseconds', 5_400_000)).toEqual({ shown: 1.5, unit: 'h' });
  expect(scaleOf('milliseconds', 250)).toEqual({ shown: 250, unit: 'ms' });
});
