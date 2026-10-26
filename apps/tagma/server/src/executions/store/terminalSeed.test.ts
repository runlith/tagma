import { describe, expect, test } from 'bun:test';
import { seedNextSize, seedPageDone, seedPageSize, seedReadiness, seedRowBytes } from './terminalSeeding.js';

describe('open-terminal seeding decisions', () => {
  test('a short page ends seeding; a full page continues, even when it held no open rows', () => {
    expect(seedPageDone(0, 500)).toBe(true);
    expect(seedPageDone(499, 500)).toBe(true);
    expect(seedPageDone(500, 500)).toBe(false);
  });

  test('the sweep reads only a durably seeded side table', () => {
    expect(seedReadiness(true, true)).toBe('ready');
    expect(seedReadiness(true, false)).toBe('ready');
    expect(seedReadiness(false, true)).toBe('wait');
    expect(seedReadiness(false, false)).toBe('refuse');
  });

  test('the row envelope grows with wider selected values', () => {
    const narrow = seedRowBytes({ executionId: 'a', incarnation: 1, dischargedAt: null });
    const wide = seedRowBytes({ executionId: 'a'.repeat(100), incarnation: 1, dischargedAt: null });
    expect(wide).toBeGreaterThan(narrow);
    const multibyte = seedRowBytes({ executionId: 'é'.repeat(10), incarnation: 1, dischargedAt: null });
    const ascii = seedRowBytes({ executionId: 'e'.repeat(10), incarnation: 1, dischargedAt: null });
    expect(multibyte).toBeGreaterThan(ascii);
  });

  test('page size scales with live free memory and never drops below one row', () => {
    expect(seedPageSize(0, 27)).toBeGreaterThanOrEqual(1);
    expect(seedPageSize(63, 1000000)).toBeGreaterThanOrEqual(1);
    const small = seedPageSize(2 ** 20, 27);
    const large = seedPageSize(2 ** 34, 27);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeGreaterThanOrEqual(1);
  });

  test('slow pages shrink, fast pages grow within the memory budget, never below one', () => {
    const memory = seedPageSize(17179869184, 27);
    expect(seedNextSize(1000, 1000, 17179869184, 27)).toBeLessThan(1000);
    expect(seedNextSize(1, 1000, 17179869184, 27)).toBeGreaterThanOrEqual(1);
    const grown = seedNextSize(100, 10, 17179869184, 27);
    expect(grown).toBeGreaterThan(100);
    expect(grown).toBeLessThanOrEqual(memory);
    expect(seedNextSize(100, 100, 17179869184, 27)).toBeLessThanOrEqual(memory);
  });
});
