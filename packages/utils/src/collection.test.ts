import { describe, expect, test } from 'bun:test';
import { arrayView, seededPick, seededShuffle, unique, uniqueBy } from './collection.js';

describe('@runlith/utils collection helpers', () => {
  test('a lazy indexed view supports array iteration, slicing and sparse-aware methods', () => {
    const view = arrayView(3, (at) => `line ${at}`);
    expect(view.length).toBe(3);
    expect(view[0]).toBe('line 0');
    expect(view[3]).toBeUndefined();
    expect([...view]).toEqual(['line 0', 'line 1', 'line 2']);
    expect([...view.entries()]).toEqual([
      [0, 'line 0'],
      [1, 'line 1'],
      [2, 'line 2'],
    ]);
    expect(view.slice(1)).toEqual(['line 1', 'line 2']);
    expect(view.flatMap((line) => [line])).toEqual([...view]);
    expect(view.filter((line) => line !== 'line 1')).toEqual(['line 0', 'line 2']);
  });

  test('keeps unique values in first-seen order', () => {
    expect(unique(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });

  test('keeps unique keyed objects in first-seen order', () => {
    const values = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'a', value: 3 },
    ];

    expect(uniqueBy(values, (value) => value.id)).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]);
  });

  test('permutations spread across seeds — a degenerate deal would BE the answer key', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      seen.add(seededShuffle([0, 1, 2, 3], `seed-${index}`).join(''));
    }
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });

  test('seededShuffle deals the same non-identity permutation for one seed', () => {
    const input = ['I', 'know', 'the word', 'murder'];
    const first = seededShuffle(input, 'call-1:tokens');
    expect(seededShuffle(input, 'call-1:tokens')).toEqual(first);
    expect(first).not.toEqual(input);
    expect([...first].sort()).toEqual([...input].sort());
    expect(seededShuffle(['a', 'b'], 'seed')).toEqual(['b', 'a']);
    expect(seededShuffle(['solo'], 'seed')).toEqual(['solo']);
  });

  test('seededPick reaches every entry of a two-entry input, the case a deal cannot', () => {
    const picked = new Set<string>();
    for (let index = 0; index < 200; index += 1) picked.add(seededPick(['cloze', 'assembly'], `seed-${index}`) ?? '');
    expect([...picked].sort()).toEqual(['assembly', 'cloze']);
  });

  test('seededPick replays one seed and answers nothing for an empty input', () => {
    const first = seededPick(['a', 'b', 'c', 'd'], 'call-1:recipe');
    expect(seededPick(['a', 'b', 'c', 'd'], 'call-1:recipe')).toBe(first);
    expect(seededPick([], 'call-1:recipe')).toBeUndefined();
  });
});
