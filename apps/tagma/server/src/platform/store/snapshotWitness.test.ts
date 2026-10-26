import { expect, test } from 'bun:test';
import { nextBatch } from './snapshotWitness.js';

test('small rows grow the next batch toward the byte budget, a step at a time', () => {
  expect(nextBatch(16, 16 * 200)).toBe(128);
  expect(nextBatch(128, 128 * 200)).toBe(1024);
});

test('large rows shrink the next batch so one page never holds more than the budget', () => {
  expect(nextBatch(2048, 2048 * 44_000)).toBeLessThan(200);
  expect(nextBatch(1, 900 * 1024 * 1024)).toBe(1);
});

test('the batch is never empty and never beyond its ceiling', () => {
  expect(nextBatch(16, 0)).toBeGreaterThanOrEqual(1);
  expect(nextBatch(50_000, 1)).toBe(50_000);
});
