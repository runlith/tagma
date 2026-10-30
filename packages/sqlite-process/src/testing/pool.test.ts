import { expect, test } from 'bun:test';
import { childHosting } from '../children';
import { inlineHosting } from '../inline';
import { hostingOfRun } from './pool';

test('a forced hosting wins over the seed, and no seed means in-process', () => {
  expect(hostingOfRun({})).toBe(inlineHosting);
  expect(hostingOfRun({ RUNLITH_SQLITE_HOSTING: 'child', RUNLITH_TEST_SEED: '1' })).toBe(childHosting);
  expect(hostingOfRun({ RUNLITH_SQLITE_HOSTING: 'inline', RUNLITH_TEST_SEED: '0' })).toBe(inlineHosting);
});

test('a seed gives each worker the same hosting every time, and some seeds take the real one', () => {
  const chosen = (seed: number, worker: string) => hostingOfRun({ RUNLITH_TEST_SEED: String(seed), BUN_TEST_WORKER_ID: worker });
  const seeds = Array.from({ length: 64 }, (_, seed) => seed);
  expect(seeds.map((seed) => chosen(seed, '3'))).toEqual(seeds.map((seed) => chosen(seed, '3')));
  const real = seeds.filter((seed) => chosen(seed, '3') === childHosting);
  expect(real.length).toBeGreaterThan(0);
  expect(real.length).toBeLessThan(seeds.length);
});
