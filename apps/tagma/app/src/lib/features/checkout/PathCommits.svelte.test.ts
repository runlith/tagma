// @vitest-environment jsdom
import type { HistoryCommit, PathHistory } from '@tagma/server/workspace/contract/wire/history';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { stubAll, stubSingle } from '@runlith/query/testing';
import { expect, test } from 'vitest';
import type { HistoryKey } from './Repo.js';
import { PathCommits } from './PathCommits.svelte.js';

const ROOT = 'root-1' as RootId;
const PATH = 'src/a.ts';

const commit = (sha: string, subject: string): HistoryCommit =>
  ({ sha, parents: [], author: 'suite', date: '2026-09-11T10:06:45+03:00', subject, graph: false }) as HistoryCommit;

const first: PathHistory = {
  rootId: ROOT,
  path: PATH,
  grep: null,
  commits: [commit('0f273656d8e1', 'the newer one'), commit('b8d80e62e1c2', 'the older one')],
  shown: 2,
  total: null,
  next: 'after-two',
  complete: true,
};
const second: PathHistory = {
  rootId: ROOT,
  path: PATH,
  grep: null,
  commits: [commit('ad8512105c09', 'the oldest one')],
  shown: 1,
  total: null,
  next: null,
  complete: true,
};

test('a measured screen loads once and its cursor appends the next screen without losing the first', () => {
  const asked: HistoryKey[] = [];
  const repo = {
    history: {
      name: 'stub',
      key: (key: HistoryKey) => {
        asked.push(key);
        return stubSingle({ data: key.cursor === undefined ? first : second });
      },
      all: stubAll,
      reset: () => undefined,
    },
  } as never;

  const commits = new PathCommits(repo, () => ({ projectId: 1, rootId: ROOT, path: PATH }));

  expect(commits.lines).toBeNull();
  expect(asked).toEqual([]);

  commits.measured(12);

  expect(commits.lines?.map((line) => line.sha)).toEqual(['0f27365', 'b8d80e6']);
  expect(commits.lines?.map((line) => line.subject)).toEqual(['the newer one', 'the older one']);
  expect(commits.more).toBe(true);
  expect(asked.at(-1)).toEqual({ projectId: 1, rootId: ROOT, path: PATH, limit: 12 });

  commits.measured(30);
  commits.askMore();

  expect(commits.lines?.map((line) => line.subject)).toEqual(['the newer one', 'the older one', 'the oldest one']);
  expect(asked.at(-1)).toEqual({ projectId: 1, rootId: ROOT, path: PATH, limit: 12, cursor: 'after-two' });
  expect(commits.more).toBe(false);
});
