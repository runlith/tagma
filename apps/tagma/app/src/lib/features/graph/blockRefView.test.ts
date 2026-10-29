import { expect, test } from 'vitest';

import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { placedLens } from './blockRefView.js';

const project = { rootPath: '/repo/main' } as Project;

test('a place naming its branch reads in that copy, main or worktree', () => {
  expect(placedLens({ projectId: 5, checkout: '/repo/main', branch: null }, null)).toEqual({ project: '5', branch: undefined });
  expect(placedLens({ projectId: 5, checkout: '/repo/wt', branch: 'subject/topic' }, null)).toEqual({
    project: '5',
    branch: 'subject/topic',
  });
});

test('a place without a branch reads in the main copy only from the main checkout', () => {
  expect(placedLens({ projectId: 5, checkout: '/repo/main' }, project)).toEqual({ project: '5' });
  expect(placedLens({ projectId: 5, checkout: '/repo/wt' }, project)).toBeNull();
  expect(placedLens({ projectId: 5, checkout: '/repo/main' }, null)).toBeNull();
});
