import { expect, test } from 'bun:test';
import { makePathSet } from './pathSet.js';

const ranked = (paths: readonly string[], query: string, recent: readonly string[] = []): readonly string[] => {
  const set = makePathSet();
  set.load(paths);
  return set.find(query, 10, recent).files.map((file) => file.path);
};

test('a name match outranks a path match, and word starts outrank scattered letters', () => {
  expect(ranked(['docs/quick/open.md', 'src/QuickOpen.ts', 'src/q/u/i/c/k.ts'], 'quick')[0]).toBe('src/QuickOpen.ts');
  expect(ranked(['src/foobar.ts', 'src/foo-bar.ts', 'src/fxoxobar.ts'], 'fb')[0]).toBe('src/foo-bar.ts');
});

test('every word must match and the positions point at the matched characters', () => {
  const set = makePathSet();
  set.load(['apps/tagma/server/rows.ts', 'apps/tagma/app/rows.svelte']);
  const found = set.find('rows svelte', 5, []);
  expect(found.matched).toBe(1);
  const only = found.files[0];
  expect(only?.path).toBe('apps/tagma/app/rows.svelte');
  expect(only?.positions.every((at) => at >= 0 && at < (only?.path.length ?? 0))).toBe(true);
  expect(set.find('rows zzz', 5, []).matched).toBe(0);
});

test('a name typed with a wrong letter is still found, below names that match as typed', () => {
  const paths = ['brand/icon-dark.svg', 'brand/icon-light.svg', 'docs/condor.md'];
  expect(ranked(paths, 'icomdark')).toEqual(['brand/icon-dark.svg']);
  expect(ranked(paths, 'icon')).toEqual(['brand/icon-dark.svg', 'brand/icon-light.svg', 'docs/condor.md']);
  expect(ranked(['notes/mdoe.txt', 'notes/xmode.txt'], 'mode')).toEqual(['notes/xmode.txt', 'notes/mdoe.txt']);
});

test('recent paths lead equal matches and are the whole answer to an empty query', () => {
  const paths = ['a/readme.md', 'b/readme.md', 'c/readme.md'];
  expect(ranked(paths, 'readme', ['c/readme.md'])[0]).toBe('c/readme.md');
  expect(ranked(paths, '', ['b/readme.md', 'gone.md', 'a/readme.md'])).toEqual(['b/readme.md', 'a/readme.md']);
});

test('a patch drops what vanished under a scanned place and keeps what stands', () => {
  const set = makePathSet();
  set.load(['src/a.ts', 'src/deep/b.ts', 'src/deep/c.ts', 'other.ts']);
  set.patch(['src/deep'], ['src/deep/c.ts', 'src/deep/new.ts']);
  const all = set.find('ts', 20, []).files.map((file) => file.path);
  expect(all.sort()).toEqual(['other.ts', 'src/a.ts', 'src/deep/c.ts', 'src/deep/new.ts']);
  set.patch(['other.ts'], []);
  expect(set.find('other', 5, []).matched).toBe(0);
});
