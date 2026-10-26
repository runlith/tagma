import { expect, test } from 'bun:test';
import { randomThreadName } from './name.js';

test('a minted name is never one the project already holds', () => {
  const taken = new Set<string>();
  for (let index = 0; index < 500; index += 1) {
    const name = randomThreadName(taken);
    expect(taken.has(name)).toBe(false);
    taken.add(name);
  }
});
