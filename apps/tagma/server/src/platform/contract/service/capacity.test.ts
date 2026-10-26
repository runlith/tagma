import { expect, test } from 'bun:test';
import { figures, heavyPool } from './capacity.js';
import { askCeiling, programCeiling } from './deadlines.js';

const GIB = 1024 ** 3;

test('the Tagma budget leaves the OS its floor, and the lowest class gets 4 GiB', () => {
  expect(figures({ parallelism: 4, memoryBytes: 8 * GIB }).serverMemory).toBe(4 * GIB);
  expect(figures({ parallelism: 12, memoryBytes: 32 * GIB }).serverMemory).toBe(16 * GIB);
  expect(figures({ parallelism: 12, memoryBytes: 12 * GIB }).serverMemory).toBe(6 * GIB);
});

test('heavy slots keep a recovery reserve, and one core still gets a slot every class can use', () => {
  expect(heavyPool({ parallelism: 8, memoryBytes: 16 * GIB })).toEqual({ name: 'heavy', units: 7, limits: { call: 6, background: 5 } });
  expect(heavyPool({ parallelism: 1, memoryBytes: 8 * GIB })).toEqual({ name: 'heavy', units: 1, limits: { call: 1, background: 1 } });
  expect(figures({ parallelism: 1, memoryBytes: 8 * GIB }).readersPerStore).toBe(2);
});

test('an ask ceiling grows with its subject up to the absolute cap, past which the subject is too large', () => {
  expect(askCeiling({ perFileMs: 5, perMibMs: 0 }, 850, 0)).toEqual({ ms: 14_250, tooLarge: false });
  expect(askCeiling({ perFileMs: 5, perMibMs: 0 }, 100_000, 0)).toEqual({ ms: 120_000, tooLarge: true });
});

test('a program without history gets 15 minutes; with history ten times its p95, within 1 and 15 minutes', () => {
  expect(programCeiling([])).toBe(900_000);
  expect(programCeiling([1_000, 2_000, 3_000])).toBe(60_000);
  expect(programCeiling(Array.from({ length: 30 }, (_, index) => (index + 1) * 1_000))).toBe(290_000);
  expect(programCeiling([600_000])).toBe(900_000);
});
