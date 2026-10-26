import { expect, test } from 'vitest';
import { percentOf, shareOf } from './units.js';

test('a share is read and typed as a percentage while the stored value stays the fraction', () => {
  expect(percentOf(0.27)).toBe(27);
  expect(shareOf(35)).toBe(0.35);
});
