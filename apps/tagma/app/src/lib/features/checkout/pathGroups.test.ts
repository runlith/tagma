import type { CheckoutEntry } from '@tagma/server/workspace/contract/wire/checkout';
import { expect, test } from 'vitest';

import { pathGroups } from './pathGroups.js';

const entry = (path: string): CheckoutEntry => ({ path, status: 'modified', lines: { added: 1, removed: 0 } }) as CheckoutEntry;

test('paths are gathered by the directory they stand in, and both the groups and their rows keep the side’s order', () => {
  const groups = pathGroups([entry('src/b.ts'), entry('README.md'), entry('src/a.ts'), entry('src/deep/one.ts'), entry('src/c.ts')]);

  expect(groups.map((group) => [group.directory, group.entries.map((one) => one.path)])).toEqual([
    ['src/', ['src/b.ts', 'src/a.ts', 'src/c.ts']],
    ['', ['README.md']],
    ['src/deep/', ['src/deep/one.ts']],
  ]);
});
