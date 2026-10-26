import { describe, expect, test } from 'bun:test';
import { Layered, SortedPaths } from './sorted';

describe('paths and maps changed by a difference', () => {
  test('a sorted path set changed by additions and removals equals one built whole, across leaves and groups', () => {
    const all = Array.from({ length: 20_000 }, (_, at) => `d${String(at % 37).padStart(2, '0')}/f${String(at).padStart(5, '0')}.ts`);
    let held = SortedPaths.of(all);
    const naive = new Set(all);
    const added = ['a/first.ts', 'd05/new.ts', 'zz/last.ts'],
      removed = new Set(['d00/f00000.ts', 'd20/f00020.ts', 'missing.ts']);
    held = held.with(added, removed);
    for (const path of added) naive.add(path);
    for (const path of removed) naive.delete(path);
    const whole = SortedPaths.of(naive);
    expect([...held]).toEqual([...whole]);
    expect(held.size).toBe(naive.size);
    expect([...held.under('d05')]).toEqual([...whole].filter((path) => path.startsWith('d05/')));
    expect([held.has('d05/new.ts'), held.has('d00/f00000.ts')]).toEqual([true, false]);
  });

  test('a layered map answers as one rebuilt whole through many layers and a flattening', () => {
    let map = Layered.of(
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
    );
    const naive = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    for (let at = 0; at < 70; at += 1) {
      const changes = new Map<string, number | undefined>([
        [`k${at}`, at],
        [at % 2 === 0 ? 'a' : `k${at - 1}`, undefined],
      ]);
      map = map.with(changes);
      for (const [key, value] of changes)
        if (value === undefined) naive.delete(key);
        else naive.set(key, value);
    }
    expect(new Map(map)).toEqual(naive);
    expect(map.size).toBe(naive.size);
  });
});
