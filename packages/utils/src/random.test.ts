import { describe, expect, test } from 'bun:test';
import { seededRandom } from './random.js';

describe('seededRandom', () => {
  test('same seed yields the same sequence', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 1000; i += 1) expect(a()).toBe(b());
  });

  test('different seeds diverge', () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    const values = Array.from({ length: 8 }, () => [a(), b()] as const);
    expect(values.some(([left, right]) => left !== right)).toBe(true);
  });

  test('values stay in [0, 1)', () => {
    const draw = seededRandom(-7);
    for (let i = 0; i < 1000; i += 1) {
      const value = draw();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
