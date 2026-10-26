import { expect, test } from 'vitest';
import { type CommitEntry, commitRuns } from './commitRuns.js';

const commit = (sha: string, graph: boolean): CommitEntry => ({ sha, subject: sha, author: 'a', date: '2026-09-23T10:00:00Z', graph });

test('a run of graph commits folds into one row, while a lone graph commit and every code commit stand as themselves', () => {
  const runs = commitRuns([commit('g1', true), commit('g2', true), commit('c1', false), commit('g3', true), commit('c2', false)], true);

  expect(runs.map((run) => (run.kind === 'commit' ? run.commit.sha : run.commits.map((one) => one.sha).join('+')))).toEqual([
    'g1+g2',
    'c1',
    'g3',
    'c2',
  ]);
  expect(commitRuns([commit('g1', true), commit('g2', true)], false).map((run) => run.kind)).toEqual(['commit', 'commit']);
});
